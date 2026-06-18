const mongoose = require("mongoose");

const videoSchema = new mongoose.Schema({
  title:    { type: String, default: "Nouvelle vidéo" },
  url:      { type: String, default: "" },
  duration: { type: String, default: "" },
});

const faqSchema = new mongoose.Schema({
  question: { type: String, required: true },
  answer:   { type: String, required: true },
});

const sectionSchema = new mongoose.Schema({
  title:  { type: String, required: true },
  order:  { type: Number, default: 0 },
  videos: [videoSchema],
  faqs:   [faqSchema],
});

const supportContentSchema = new mongoose.Schema(
  { sections: [sectionSchema] },
  { timestamps: true }
);

module.exports = mongoose.model("SupportContent", supportContentSchema);
