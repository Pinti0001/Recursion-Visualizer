// Built-in example programs for the Recursion Visualizer
// Each example has: name, description, code

const EXAMPLES = {
  fibonacci: {
    name: 'Fibonacci',
    description: 'Classic recursive Fibonacci: fib(n) = fib(n-1) + fib(n-2). Best example to understand recursive branching.',
    code: `int fib(int n) {
    if (n < 2) {
        printf("  %d\\n", n);
        return n;
    }

    printf("%d ", n);

    return fib(n - 1) + fib(n - 2);
}

int main() {
    int result = fib(5);
    printf("fib(5) = %d\\n", result);
    return 0;
}`,
  },

  factorial: {
    name: 'Factorial',
    description: 'Recursive factorial: n! = n * (n-1)!  The base case is n <= 1.',
    code: `int factorial(int n) {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}

int main() {
    int result = factorial(6);
    printf("6! = %d\\n", result);
    return 0;
}`,
  },

  power: {
    name: 'Power (Exponentiation)',
    description: 'Recursive power function: base^exp = base * base^(exp-1)',
    code: `int power(int base, int exp) {
    if (exp == 0) {
        return 1;
    }
    return base * power(base, exp - 1);
}

int main() {
    int result = power(2, 8);
    printf("2^8 = %d\\n", result);
    return 0;
}`,
  },

  gcd: {
    name: 'GCD (Euclidean Algorithm)',
    description: 'Greatest Common Divisor using Euclid\'s recursive algorithm: gcd(a,b) = gcd(b, a%b)',
    code: `int gcd(int a, int b) {
    if (b == 0) {
        return a;
    }
    return gcd(b, a % b);
}

int main() {
    int result = gcd(48, 18);
    printf("gcd(48, 18) = %d\\n", result);
    return 0;
}`,
  },

  sumN: {
    name: 'Sum 1 to N',
    description: 'Sum of first N natural numbers: sum(n) = n + sum(n-1)',
    code: `int sumN(int n) {
    if (n <= 0) {
        return 0;
    }
    return n + sumN(n - 1);
}

int main() {
    int result = sumN(7);
    printf("sum(7) = %d\\n", result);
    return 0;
}`,
  },

  countdown: {
    name: 'Countdown',
    description: 'Simple countdown using tail recursion. Great for understanding the call/return flow.',
    code: `void countdown(int n) {
    if (n <= 0) {
        printf("Go!\\n");
        return;
    }
    printf("%d... ", n);
    countdown(n - 1);
}

int main() {
    countdown(5);
    return 0;
}`,
  },

  hanoi: {
    name: 'Tower of Hanoi',
    description: 'Move N disks from peg 1 to peg 3 using peg 2 as auxiliary. Classic recursive puzzle.',
    code: `void hanoi(int n, int from, int to, int via) {
    if (n == 1) {
        printf("Disk 1: %d -> %d\\n", from, to);
        return;
    }
    hanoi(n - 1, from, via, to);
    printf("Disk %d: %d -> %d\\n", n, from, to);
    hanoi(n - 1, via, to, from);
}

int main() {
    hanoi(3, 1, 3, 2);
    return 0;
}`,
  },

  binarySearch: {
    name: 'Binary Search',
    description: 'Recursive binary search: searches sorted range [left, right] for target.',
    code: `int bsearch(int left, int right, int target) {
    if (left > right) {
        return -1;
    }
    int mid = left + (right - left) / 2;
    printf("Checking index %d\\n", mid);
    if (mid == target) {
        return mid;
    }
    if (mid < target) {
        return bsearch(mid + 1, right, target);
    }
    return bsearch(left, mid - 1, target);
}

int main() {
    int result = bsearch(0, 15, 11);
    printf("Found at index: %d\\n", result);
    return 0;
}`,
  },
};
