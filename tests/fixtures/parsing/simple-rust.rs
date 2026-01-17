//! Module documentation for the parsing test fixtures.
//!
//! This module demonstrates various Rust constructs for tree-sitter parsing tests.

use std::collections::HashMap;
use std::fmt::{self, Display};
use std::io::{self, Read, Write};
use std::sync::{Arc, Mutex};

use crate::module::helper;
use self::submodule::item;
use super::parent::ParentStruct;

// Aliased import
use std::path::PathBuf as Path;

/// A simple public function with no parameters.
pub fn simple_function() -> String {
    String::from("hello")
}

/// A function with typed parameters.
///
/// # Arguments
/// * `name` - The name to greet
/// * `count` - Number of times to greet
pub fn function_with_params(name: &str, count: i32) -> String {
    let mut result = String::new();
    for _ in 0..count {
        result.push_str(&format!("Hello, {}!\n", name));
    }
    result
}

/// A private helper function.
fn private_helper(value: i32) -> i32 {
    value * 2
}

/// An async function for demonstration.
pub async fn async_function(url: &str) -> Result<String, io::Error> {
    Ok(format!("Fetched: {}", url))
}

/// A const function (can be evaluated at compile time).
pub const fn const_function(a: i32, b: i32) -> i32 {
    a + b
}

/// A simple struct representing a 2D point.
#[derive(Debug, Clone, Copy)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    /// Creates a new Point.
    pub fn new(x: f64, y: f64) -> Self {
        Point { x, y }
    }

    /// Calculates the distance from origin.
    pub fn distance(&self) -> f64 {
        (self.x * self.x + self.y * self.y).sqrt()
    }

    /// Scales the point by a factor.
    pub fn scale(&mut self, factor: f64) {
        self.x *= factor;
        self.y *= factor;
    }
}

/// A trait for animals.
pub trait Animal {
    /// Returns the sound the animal makes.
    fn speak(&self) -> String;

    /// Returns the animal's name.
    fn name(&self) -> &str;

    /// Default implementation for greeting.
    fn greet(&self) -> String {
        format!("{} says hello!", self.name())
    }
}

/// A struct representing a dog.
pub struct Dog {
    name: String,
    breed: String,
}

impl Dog {
    /// Creates a new Dog.
    pub fn new(name: &str, breed: &str) -> Self {
        Dog {
            name: name.to_string(),
            breed: breed.to_string(),
        }
    }

    /// Gets the dog's breed.
    pub fn breed(&self) -> &str {
        &self.breed
    }
}

impl Animal for Dog {
    fn speak(&self) -> String {
        format!("{} says woof!", self.name)
    }

    fn name(&self) -> &str {
        &self.name
    }
}

/// An enum representing different colors.
#[derive(Debug, Clone, PartialEq)]
pub enum Color {
    Red,
    Green,
    Blue,
    Custom(u8, u8, u8),
}

impl Color {
    /// Creates a custom color.
    pub fn custom(r: u8, g: u8, b: u8) -> Self {
        Color::Custom(r, g, b)
    }
}

/// A type alias for a result type.
pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

/// A generic struct with type parameters.
pub struct Pair<K, V>
where
    K: Eq + std::hash::Hash,
{
    pub key: K,
    pub value: V,
}

impl<K, V> Pair<K, V>
where
    K: Eq + std::hash::Hash,
{
    /// Creates a new pair.
    pub fn new(key: K, value: V) -> Self {
        Pair { key, value }
    }
}

/// A generic function with type bounds.
pub fn generic_function<T: Display + Clone>(items: &[T]) -> String {
    items
        .iter()
        .map(|item| item.to_string())
        .collect::<Vec<_>>()
        .join(", ")
}

/// A const item.
pub const MAX_SIZE: usize = 1024;

/// A static item.
pub static GLOBAL_COUNTER: Mutex<i32> = Mutex::new(0);

/// A private const.
const INTERNAL_BUFFER_SIZE: usize = 256;

/// Function demonstrating various function calls.
pub fn function_with_calls() {
    // Direct function call
    let result = simple_function();
    println!("{}", result);

    // Function call with arguments
    let greeting = function_with_params("World", 3);
    println!("{}", greeting);

    // Method calls
    let point = Point::new(3.0, 4.0);
    let distance = point.distance();
    println!("Distance: {}", distance);

    // Chained method calls
    let dog = Dog::new("Buddy", "Golden Retriever");
    let sound = dog.speak();
    println!("{}", sound);

    // Standard library calls
    let mut map: HashMap<String, i32> = HashMap::new();
    map.insert("key".to_string(), 42);

    // Generic function call
    let items = vec!["a", "b", "c"];
    let joined = generic_function(&items);
    println!("{}", joined);
}

/// A struct with lifetimes.
pub struct StringRef<'a> {
    pub data: &'a str,
}

impl<'a> StringRef<'a> {
    /// Creates a new StringRef.
    pub fn new(data: &'a str) -> Self {
        StringRef { data }
    }

    /// Returns the length of the string.
    pub fn len(&self) -> usize {
        self.data.len()
    }

    /// Returns whether the string is empty.
    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }
}

/// A function with pub(crate) visibility.
pub(crate) fn crate_visible_function() -> i32 {
    42
}

/// A function with pub(super) visibility.
pub(super) fn super_visible_function() -> i32 {
    24
}
