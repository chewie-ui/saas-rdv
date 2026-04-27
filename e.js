let numbers = [3, 7, 2, 9, 4, 8];

let max = numbers[0];
let secondMax = numbers[0];

for (let num of numbers) {
  if (num > max) {
    secondMax = max;
    max = num;
  } else if (num > secondMax && num !== max) {
    secondMax = num;
  }
}
