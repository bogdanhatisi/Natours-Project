const crypto = require('crypto');
const { promisify } = require('util'); // using ES6 destructuring
const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const sendEmail = require('../utils/email');

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });

const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id);

  const cookieOptions = {
    expires: new Date(
      Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000
    ),

    httpOnly: true,
  };

  if (process.env.NODE_ENV === 'production') cookieOptions.secure = true;
  res.cookie('jwt', token, cookieOptions);

  // Remove password from response
  user.password = undefined;

  res.status(statusCode).json({
    status: 'success',
    token,
    data: {
      user,
    },
  });
};

exports.signup = catchAsync(async (req, res, next) => {
  const newUser = await User.create({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
    passwordChangedAt: req.body.passwordChangedAt,
  });

  createSendToken(newUser, 201, res); // 201 - created
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body; // using ES6 destructuring
  // 1) Check if email and password exist
  if (!email || !password) {
    return next(new AppError('Please provide email and password', 400)); // 400 - bad request
  }
  // 2) Check if user exists && password is correct
  const user = await User.findOne({ email }).select('+password');

  if (!user || !(await user.correctPassword(password, user.password))) {
    return next(new AppError('Incorrect email or password', 401)); //401 - unauthorized
  }
  // 3) If everything ok, send token to client

  createSendToken(user, 200, res); // 200 for ok
});

exports.protect = catchAsync(async (req, res, next) => {
  // 1) Getting and checking the token (if it exists)
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }
  //console.log(token);

  if (!token) {
    return next(
      new AppError(
        'You are not logged in! Please log in to be granted access',
        401
      )
    ); // 401 - not authorized
  }
  // 2) Verify the token
  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

  // 3) Check if user still exists
  const freshUser = await User.findById(decoded.id);
  if (!freshUser) {
    return next(
      new AppError(
        'The user belonging to this token does no longer exist!',
        401
      )
    );
  }

  // 4) Check if user changed password after the token was issued
  if (freshUser.changedPasswordAfter(decoded.iat)) {
    return next(
      new AppError(
        'The password has been recently changed! Please log in again!',
        401
      )
    );
  } // iat - issued at

  // If everything is ok, grant access to the PROTECTED route

  req.user = freshUser;
  next();
});

exports.restrictTo =
  (...roles) =>
  (req, res, next) => {
    // roles is an array ['admin','lead-guide']
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError('You do not have access to perform this action', 403)
      ); // 403 - forbidden
    }
    next();
  };

exports.forgotPassword = catchAsync(async (req, res, next) => {
  // 1) Get user based on POSTed email
  const user = await User.findOne({ email: req.body.email });
  if (!user) {
    return next(new AppError('Invalid email address', 404)); // 404 - not found
  }

  // 2) Generate the random reset token
  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  // 3) Send it to user's email
  const resetURL = `${req.protocol}://${req.get(
    'host'
  )}/api/v1/users/resetPassword/${resetToken}}`;

  const message = `Forgot your password? Submit a PATCH request with your new password to: ${resetURL}. \n If you didn't forget the password, ignore this message`;

  try {
    await sendEmail({
      email: user.email,
      subject: 'Your password reset token ( expires in 10 minutes).',
      message,
    });

    res.status(200).json({
      status: 'success',
      message: 'Password reset link sent to the provided email',
    });
  } catch (err) {
    console.log(err);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

    return next(
      new AppError(
        'There was an error sending the email. Please try again later!',
        500
      )
    ); // 500 - internal errro
  }
});

exports.resetPassword = catchAsync(async (req, res, next) => {
  // 1) Get user based on the token

  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() }, // compare the expire date with right now
  });

  // 2) If token has not expired, and the user exists, set the new password

  if (!user) {
    return next(new AppError('Token is invalid or has expired', 400)); // 400 for bad request
  }

  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  // 3) Update changedPasswordAt property on the user

  // 4) Log the user in, send JWT(JSON WEB TOKEN)

  createSendToken(user, 200, res);
});

exports.updatePassword = catchAsync(async (req, res, next) => {
  // 1) Get user from collection
  const user = await User.findById(req.user.id).select('+password');

  // 2) Check if POSTed current password is correct
  if (!(await user.correctPassword(req.body.passwordCurrent, user.password))) {
    return next(new AppError('Wrong current password!', 401));
  }

  // 3) If so, update the password

  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  // User.findByIDAndUpdate will not work as intended
  await user.save();
  // 4) Log user in , send JWT

  createSendToken(user, 200, res);
});
