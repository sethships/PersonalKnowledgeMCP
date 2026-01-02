/**
 * A simple JavaScript function.
 */
function greet(name) {
  return `Hello, ${name}!`;
}

/**
 * An async function.
 */
async function fetchUser(id) {
  const response = await fetch(`/api/users/${id}`);
  return response.json();
}

// Arrow function
const add = (a, b) => a + b;

// Class
class Calculator {
  constructor(initialValue = 0) {
    this.value = initialValue;
  }

  add(x) {
    this.value += x;
    return this;
  }

  subtract(x) {
    this.value -= x;
    return this;
  }

  getResult() {
    return this.value;
  }
}

// Exported values
module.exports = {
  greet,
  fetchUser,
  add,
  Calculator,
};
