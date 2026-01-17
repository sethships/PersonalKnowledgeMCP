/**
 * Java file demonstrating various import patterns.
 */
package com.example.imports;

// Standard imports
import java.util.List;
import java.util.ArrayList;
import java.util.Map;
import java.util.HashMap;

// Wildcard import
import java.io.*;

// Static imports
import static java.lang.Math.PI;
import static java.lang.Math.sqrt;
import static java.util.Collections.*;

// Nested package imports
import javax.swing.JFrame;
import javax.swing.JButton;

/**
 * Class to demonstrate imports.
 */
public class ImportDemo {
    private List<String> items;
    private Map<String, Integer> counts;

    public ImportDemo() {
        this.items = new ArrayList<>();
        this.counts = new HashMap<>();
    }

    public double calculateCircleArea(double radius) {
        // Using static import PI
        return PI * radius * radius;
    }

    public double calculateHypotenuse(double a, double b) {
        // Using static import sqrt
        return sqrt(a * a + b * b);
    }
}
