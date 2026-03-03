let daysOffArray = [];

export function getDays() {
  return daysOffArray;
}

export function setDays(data) {
  daysOffArray = data;
}

export function addDay(dateKey) {
  if (!daysOffArray.includes(dateKey)) {
    daysOffArray.push(dateKey);
  }
}

export function removeDay(dateKey) {
  daysOffArray = daysOffArray.filter(d => d !== dateKey);
}