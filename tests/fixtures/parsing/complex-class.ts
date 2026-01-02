/**
 * Base class for all animals.
 */
export abstract class Animal {
  protected name: string;

  constructor(name: string) {
    this.name = name;
  }

  abstract makeSound(): string;

  getName(): string {
    return this.name;
  }
}

/**
 * Interface for animals that can fly.
 */
export interface Flyable {
  fly(): void;
  getAltitude(): number;
}

/**
 * Interface for animals that can swim.
 */
export interface Swimmable {
  swim(): void;
  getDepth(): number;
}

/**
 * A bird that can fly.
 */
export class Bird extends Animal implements Flyable {
  private altitude: number = 0;

  constructor(name: string, private readonly wingspan: number) {
    super(name);
  }

  makeSound(): string {
    return "chirp";
  }

  fly(): void {
    this.altitude = 100;
  }

  getAltitude(): number {
    return this.altitude;
  }

  static createSparrow(): Bird {
    return new Bird("Sparrow", 20);
  }
}

/**
 * A duck that can both fly and swim.
 */
export class Duck extends Bird implements Swimmable {
  private depth: number = 0;

  swim(): void {
    this.depth = 5;
  }

  getDepth(): number {
    return this.depth;
  }

  override makeSound(): string {
    return "quack";
  }
}

/**
 * Generic container class.
 */
export class Container<T> {
  private items: T[] = [];

  add(item: T): void {
    this.items.push(item);
  }

  get(index: number): T | undefined {
    return this.items[index];
  }

  getAll(): T[] {
    return [...this.items];
  }
}

/**
 * Type alias for a callback function.
 */
export type Callback<T, R> = (value: T) => R;

/**
 * Enum for days of the week.
 */
export enum DayOfWeek {
  Monday = 1,
  Tuesday = 2,
  Wednesday = 3,
  Thursday = 4,
  Friday = 5,
  Saturday = 6,
  Sunday = 7,
}
