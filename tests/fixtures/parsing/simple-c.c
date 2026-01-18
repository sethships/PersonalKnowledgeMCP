/**
 * Simple C test fixture for tree-sitter parsing.
 *
 * Contains basic C constructs: functions, structs, unions, enums, typedefs.
 */

#include <stdio.h>
#include <stdlib.h>
#include "local_header.h"

/* Enum definition */
enum Status {
    STATUS_OK = 0,
    STATUS_ERROR = 1,
    STATUS_PENDING = 2
};

/* Struct definition */
struct Point {
    int x;
    int y;
};

/* Union definition */
union Data {
    int i;
    float f;
    char c;
};

/* Typedef declaration */
typedef struct Point Point2D;

/* Typedef with inline struct */
typedef struct {
    int width;
    int height;
} Rectangle;

/**
 * A simple function that adds two numbers.
 *
 * @param a First number
 * @param b Second number
 * @return Sum of a and b
 */
int add(int a, int b) {
    return a + b;
}

/* Function with pointer parameter */
void print_point(struct Point* p) {
    printf("Point(%d, %d)\n", p->x, p->y);
}

/* Function that calls other functions */
int main(int argc, char* argv[]) {
    int result = add(1, 2);
    printf("Result: %d\n", result);

    struct Point p = {10, 20};
    print_point(&p);

    return 0;
}

/* Variadic function */
int sum(int count, ...) {
    return 0;
}
