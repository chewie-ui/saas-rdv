const { Schema, model } = require("mongoose");

const SectionSchema = new Schema({
  id:      { type: String, required: true },
  type:    { type: String, enum: ["hero","services","booking","about","gallery","testimonials","faq","contact","stats","cta"], required: true },
  enabled: { type: Boolean, default: true },
  order:   { type: Number, default: 0 },
  data:    { type: Schema.Types.Mixed, default: {} },
}, { _id: false });

const SiteSchema = new Schema({
  company:     { type: Schema.Types.ObjectId, ref: "Company", required: true, unique: true },
  slug:        { type: String, unique: true, lowercase: true, trim: true, sparse: true },
  isPublished: { type: Boolean, default: false },
  theme: {
    primaryColor: { type: String, default: "#6c47d0" },
    bgColor:      { type: String, default: "#ffffff" },
    textColor:    { type: String, default: "#0f0f1a" },
    fontFamily:   { type: String, default: "Inter" },
    roundness:    { type: String, default: "soft" },
  },
  seo: {
    title:       { type: String, default: "" },
    description: { type: String, default: "" },
  },
  sections: [SectionSchema],
  logoUrl:      { type: String, default: "" },
  customDomain: { type: String, default: "", trim: true, lowercase: true },
  social: {
    instagram: { type: String, default: "" },
    facebook:  { type: String, default: "" },
    tiktok:    { type: String, default: "" },
    whatsapp:  { type: String, default: "" },
    linkedin:  { type: String, default: "" },
    youtube:   { type: String, default: "" },
  },
  visitCount: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = model("Site", SiteSchema);
