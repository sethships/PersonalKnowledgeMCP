// Default import
import React from "react";

// Named imports
import { useState, useEffect, type ReactNode } from "react";

// Aliased import
import { Component as ReactComponent } from "react";

// Namespace import
import * as path from "node:path";

// Side-effect import
import "./styles.css";

// Type-only import
import type { FC, PropsWithChildren } from "react";

// Relative imports
import { helper } from "./utils";
import { Config } from "../config";

// Re-export
export { helper } from "./utils";
export { Config as AppConfig } from "../config";

// Export all from module
export * from "./types";

// Type-only export
export type { SomeType } from "./internal-types";

// Named exports
export { useState, useEffect };

// Default export
const MainComponent: FC = () => {
  return null;
};

export default MainComponent;
