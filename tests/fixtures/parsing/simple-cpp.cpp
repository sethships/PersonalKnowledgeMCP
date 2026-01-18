/**
 * Simple C++ test fixture for tree-sitter parsing.
 *
 * Contains C++ constructs: classes, templates, namespaces, and C constructs.
 */

#include <iostream>
#include <vector>
#include <string>
#include "local_header.hpp"

// Namespace definition
namespace geometry {

/// A point in 2D space.
class Point {
public:
    int x;
    int y;

    Point() : x(0), y(0) {}
    Point(int x, int y) : x(x), y(y) {}

    /// Calculate distance from origin
    double distanceFromOrigin() const {
        return sqrt(x * x + y * y);
    }
};

// Struct (C-style but in C++)
struct Rectangle {
    int width;
    int height;
};

} // namespace geometry

// Enum (C++11 style)
enum class Color {
    Red,
    Green,
    Blue
};

// Template class
template<typename T>
class Container {
public:
    T value;

    Container(T val) : value(val) {}

    T getValue() const {
        return value;
    }
};

// Template function
template<typename T>
T add(T a, T b) {
    return a + b;
}

// Regular function
int multiply(int a, int b) {
    return a * b;
}

// Function that calls methods and other functions
int main() {
    geometry::Point p(10, 20);
    std::cout << "Distance: " << p.distanceFromOrigin() << std::endl;

    Container<int> container(42);
    std::cout << "Value: " << container.getValue() << std::endl;

    int sum = add<int>(1, 2);
    int product = multiply(3, 4);

    std::cout << "Sum: " << sum << ", Product: " << product << std::endl;

    return 0;
}

// Class with inheritance
class Shape {
public:
    virtual double area() const = 0;
    virtual ~Shape() {}
};

class Circle : public Shape {
private:
    double radius;

public:
    Circle(double r) : radius(r) {}

    double area() const override {
        return 3.14159 * radius * radius;
    }
};
