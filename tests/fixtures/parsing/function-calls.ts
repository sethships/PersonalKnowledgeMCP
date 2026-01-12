/**
 * Test fixture for function call extraction.
 *
 * Contains various patterns of function/method calls to test
 * the extractCalls functionality of TreeSitterParser.
 */

// ==================== Direct Function Calls ====================

function simpleCall() {
  console.log("hello");
}

function multipleCallsSameFunction() {
  validate();
  validate();
  validate();
}

function nestedCalls() {
  outer(inner());
}

// ==================== Async/Await Calls ====================

async function asyncFunction() {
  await fetchData();
  const result = await processResult();
  return result;
}

async function mixedAsyncSync() {
  syncFunction();
  await asyncFunction();
  anotherSync();
}

// ==================== Method Calls ====================

function methodCalls() {
  const obj = {
    method: () => {},
  };
  obj.method();
  obj.anotherMethod();
}

function chainedMethodCalls() {
  builder.setName("test").setAge(25).build();
}

function deepPropertyAccess() {
  this.service.repository.find();
}

// ==================== Calls in Different Contexts ====================

class MyClass {
  private helper: { process: () => void };

  constructor() {
    this.helper = { process: () => {} };
    this.initialize();
  }

  public doWork() {
    this.helper.process();
    externalHelper();
  }

  private initialize() {
    setup();
  }

  static staticMethod() {
    staticHelper();
  }
}

// ==================== Arrow Functions ====================

const arrowFunction = () => {
  callFromArrow();
};

const arrowWithParams = (x: number) => {
  processNumber(x);
};

// ==================== Higher Order Functions ====================

function higherOrder() {
  [1, 2, 3].map((x) => transform(x));
  [1, 2, 3].filter((x) => validate(x));
  [1, 2, 3].forEach((x) => process(x));
}

// ==================== Optional Chaining ====================

function optionalChaining() {
  obj?.method();
  deeply?.nested?.call();
}

// ==================== Dynamic Calls ====================

function dynamicCalls() {
  const methodName = "dynamic";
  // obj[methodName](); // Dynamic - harder to extract
}

// ==================== IIFE ====================

(function immediatelyInvoked() {
  iife();
})();

(() => {
  arrowIife();
})();

// ==================== Callbacks ====================

function withCallback() {
  setTimeout(() => {
    callbackAction();
  }, 1000);

  promise.then((result) => {
    handleResult(result);
  });
}

// ==================== Exported Functions ====================

export function exportedWithCalls() {
  internalCall();
}

export async function exportedAsync() {
  await asyncInternalCall();
}
