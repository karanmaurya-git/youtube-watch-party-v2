import User from '../models/User.js';

export const findUserByEmail = (email) => User.findOne({ email });
export const findUserById = (id) => User.findById(id);
export const createUser = ({ name, email, passwordHash }) =>
  User.create({ name, email, password: passwordHash });

/** Never expose the password hash. */
export const toPublicUser = (user) => ({
  id: String(user._id),
  name: user.name,
  email: user.email,
});
