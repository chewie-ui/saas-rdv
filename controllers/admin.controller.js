exports.panel = (req, res) => {
  res.render("panel", {
    pageName: "Dashboard",
    appointments: req.appointments,
  });
};

function getWeekDays(startDate = new Date()) {
  const week = [];
  const monday = new Date(startDate);

  // Revenir au lundi
  const day = monday.getDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + diff);

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);

    week.push({
      label: d.toLocaleDateString("en-US", { weekday: "short" }), // Mon
      date: d.toLocaleDateString("en-US", {
        day: "numeric",
        month: "long",
      }), // 9 February
      iso: d.toISOString(),
    });
  }

  return week;
}

exports.appointment = (req, res) => {
  res.render("appointment", {
    pageName: "Appointment",
    hours: [
      "08:00",
      "09:00",
      "10:00",
      "11:00",
      "12:00",
      "13:00",
      "14:00",
      "15:00",
      "16:00",
      "17:00",
      "18:00",
    ],
    weekDays: getWeekDays(),
    appointments: [
      {
        name: "Doctor Fring",
        weekday: 1,
        startHour: "08:00",
        endHour: "08:30",
      },
      {
        name: "Edouard Blagon",
        weekday: 0,
        startHour: "08:30",
        endHour: "09:00",
      },
    ],
  });
};
