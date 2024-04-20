const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/user');
const Course = require('../models/course');
const CourseProgress = require("../models/courseProgress");
const mailSender = require('../utils/mailSender');
const { courseEnrollmentEmail } = require('../mail/templates/courseEnrollmentEmail');

exports.capturePayment = async (req, res) => {
    const { coursesId } = req.body;
    const userId = req.user.id;

    if (!coursesId.length) {
        return res.json({ success: false, message: "Please provide Course Id" });
    }

    let totalAmount = 0;

    for (const courseId of coursesId) {
        try {
            const course = await Course.findById(courseId);
            if (!course) {
                return res.status(404).json({ success: false, message: "Could not find the course" });
            }
            totalAmount += course.price;
        } catch (error) {
            console.log(error);
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: totalAmount * 100, // amount in cents
            currency: 'usd',
        });
        res.status(200).json({
            success: true,
            clientSecret: paymentIntent.client_secret
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Could not initiate payment" });
    }
};

exports.verifyPayment = async (req, res) => {
    const { paymentIntentId, coursesId } = req.body;
    const userId = req.user.id;

    if (!paymentIntentId || !coursesId || !userId) {
        return res.status(400).json({ success: false, message: "Payment data not found" });
    }

    try {
        // Confirm the Payment Intent using the client-side confirmation approach
        const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId);

        if (paymentIntent.status === 'succeeded') {
            await enrollStudents(coursesId, userId);
            return res.status(200).json({ success: true, message: "Payment Verified" });
        } else {
            return res.status(200).json({ success: false, message: "Payment Failed" });
        }
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Error verifying payment" });
    }
};

const enrollStudents = async (coursesId, userId) => {
    for (const courseId of coursesId) {
        try {
            // find the course and enroll the student in it
            const enrolledCourse = await Course.findByIdAndUpdate(
                courseId,
                { $addToSet: { studentsEnrolled: userId } },
                { new: true }
            );
            if (!enrolledCourse) {
                console.log(`Course ${courseId} not found`);
                continue;
            }
            // Initialize course progress
            await CourseProgress.create({
                courseID: courseId,
                userId: userId,
                completedVideos: [],
            });
            // Add the course to the student's list of enrolled courses
            await User.findByIdAndUpdate(
                userId,
                { $addToSet: { courses: courseId } },
                { new: true }
            );
            // Send enrollment email
            const enrolledStudent = await User.findById(userId);
            await mailSender(
                enrolledStudent.email,
                `Successfully Enrolled into ${enrolledCourse.courseName}`,
                courseEnrollmentEmail(enrolledCourse.courseName, enrolledStudent.firstName)
            );
        } catch (error) {
            console.log(error);
        }
    }
};
