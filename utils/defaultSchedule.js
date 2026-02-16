module.exports = function generateDefaultSchedule() {
  return Array.from({ length: 7 }, (_, i) => ({
    weekdayIndex: i,
    dayOff: i === 0, // dimanche OFF
    workingHours: [
      {
        start: "08:00",
        end: "17:00",
      },
    ],
  }));
};
