const User = require('../models/userModel');

// @desc    Get all users
// @route   GET /api/users
// @access  Public
const getUsers = async (req, res) => {
  try {
    const users = await User.find();
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a new user
// @route   POST /api/users
// @access  Public
const createUser = async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) {
      return res.status(400).json({ message: 'Please provide name and email' });
    }
    const user = await User.create({ name, email });
    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getUsers,
  createUser,
};
