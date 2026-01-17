/**
 * A simple Java class for testing basic parsing.
 */
package com.example.test;

import java.util.List;
import java.util.ArrayList;
import static java.lang.Math.PI;

/**
 * Simple class with basic members.
 */
public class SimpleClass {
    private String name;
    private int count;
    public static final String CONSTANT = "test";

    /**
     * Constructor for SimpleClass.
     * @param name The name
     */
    public SimpleClass(String name) {
        this.name = name;
        this.count = 0;
    }

    /**
     * Get the name.
     * @return The name
     */
    public String getName() {
        return this.name;
    }

    /**
     * Set the name.
     * @param name The new name
     */
    public void setName(String name) {
        this.name = name;
    }

    /**
     * Calculate something with the count.
     * @param multiplier The multiplier
     * @return The calculated value
     */
    public int calculate(int multiplier) {
        int result = this.count * multiplier;
        System.out.println("Calculated: " + result);
        return result;
    }

    /**
     * Static method example.
     */
    public static void staticMethod() {
        System.out.println("Static method called");
    }
}
