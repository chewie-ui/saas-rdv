const mongoose = require("mongoose");
const schema = mongoose.Schema;

const questionSchema = new schema({
  label: { type: String, required: true },
  type: {
    type: String,
    enum: ["text", "choice", "yes_no"],
    default: "text",
  },
  required: { type: Boolean, default: false },
  options: [{ type: String }],
  order: { type: Number, default: 0 },
});

const formSchema = new schema(
  {
    company: {
      type: schema.Types.ObjectId,
      ref: "Company",
      required: true,
      unique: true,
    },
    active: { type: Boolean, default: false },
    questions: [questionSchema],
  },
  { timestamps: true },
);

const Form = mongoose.model("Form", formSchema);
module.exports = Form;
