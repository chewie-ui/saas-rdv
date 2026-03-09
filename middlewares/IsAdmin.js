module.exports = (req, res, next) => {
  const grade = res.locals.grade;

  const allowedGrades = ["admin", "owner"];

  const isAuthorized = allowedGrades.includes(grade);

  if (isAuthorized) {
    return next();
  }
  console.log("ACCÈS REFUSÉ POUR:", grade);
  return res.status(403).json({
    error: "Access denied",
  });
};
