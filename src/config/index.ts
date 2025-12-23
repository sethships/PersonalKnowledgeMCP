/**
 * Configuration Module Exports
 *
 * @module config
 */

export {
  // Types
  type InstanceConfig,
  type InstanceChromaConfig,
  type MultiInstanceConfig,
  // Constants
  INSTANCE_NAMES,
  InstanceAccessSchema,
  // Functions
  loadInstanceConfig,
  getEnabledInstances,
  isValidInstanceName,
  getInstanceConfig,
} from "./instance-config.js";
