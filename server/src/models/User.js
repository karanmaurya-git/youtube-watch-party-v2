import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 50 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // bcrypt hash, never the plain password
    password: { type: String, required: true },
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);
