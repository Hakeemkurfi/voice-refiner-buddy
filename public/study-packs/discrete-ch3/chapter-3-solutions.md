# Discrete Mathematics Chapter 3 — test exercises solution guide (Epp)

Checked worked solutions for the assigned test exercises from Susanna Epp, Discrete Mathematics with Applications, Chapter 3 (The Logic of Quantified Statements): Exercise 3.1 odd 1-33, Exercise 3.2 odd 1-49 and 50, Exercise 3.3 odd 1-59. Answers follow the book's own solution guide (Appendix B) and the chapter's worked examples. When a test question matches or closely resembles one of these exercises, solve it the same way, in the same notation, using the actual numbers and wording of the test question.

### Exercise 3.1 #1 (book page 119)
Question: A menagerie consists of seven brown dogs, two black dogs, six gray cats, ten black cats, five blue birds, six yellow birds, and one black bird. Determine which of the following statements are true and which are false.
a. There is an animal in the menagerie that is red.
b. Every animal in the menagerie is a bird or a mammal.
c. Every animal in the menagerie is brown or gray or black.
d. There is an animal in the menagerie that is neither a cat nor a dog.
e. No animal in the menagerie is blue.
f. There are in the menagerie a dog, a cat, and a bird that all have the same color.
Solution:
a. None of the listed animals is red. Answer: False.
b. Every animal is a dog, a cat, or a bird; dogs and cats are mammals. Answer: True.
c. The blue birds are neither brown nor gray nor black. Answer: False.
d. Any of the birds is neither a cat nor a dog. Answer: True.
e. There are five blue birds. Answer: False.
f. There are black dogs, black cats, and a black bird. Answer: True.
Source: book answer key

### Exercise 3.1 #3 (book page 119)
Question: Let R(m, n) be the predicate “If m is a factor of n² then m is a factor of n,” with domain for both m and n being ℤ, the set of integers.
a. Explain why R(m, n) is false if m = 25 and n = 10.
b. Give values different from those in part (a) for which R(m, n) is false.
c. Explain why R(m, n) is true if m = 5 and n = 10.
d. Give values different from those in part (c) for which R(m, n) is true.
Solution:
a. 10² = 100 = 25·4, but 10/25 is not an integer. The hypothesis is true and the conclusion is false. Answer: R(25, 10) is false.
b. Let m = 4 and n = 2. Then 2² = 4 = 4·1, but 2/4 is not an integer. Answer: R(4, 2) is false.
c. 10² = 100 = 5·20 and 10 = 5·2. Both the hypothesis and the conclusion are true. Answer: R(5, 10) is true.
d. Let m = 3 and n = 6. Then 6² = 36 = 3·12 and 6 = 3·2. Answer: R(3, 6) is true.
Source: book answer key

### Exercise 3.1 #5 (book page 119)
Question: Find the truth set of each predicate.
a. Predicate: 6/d is an integer; domain: ℤ.
b. Predicate: 6/d is an integer; domain: ℤ⁺.
c. Predicate: 1 ≤ x² ≤ 4; domain: ℝ.
d. Predicate: 1 ≤ x² ≤ 4; domain: ℤ.
Solution:
a. The nonzero integer divisors of 6 are ±1, ±2, ±3, ±6; at d = 0 the quotient is undefined. Answer: {−6, −3, −2, −1, 1, 2, 3, 6}.
b. Retain the positive divisors from (a). Answer: {1, 2, 3, 6}.
c. 1 ≤ x² ≤ 4 is equivalent to 1 ≤ |x| ≤ 2. Answer: {x ∈ ℝ | −2 ≤ x ≤ −1 ∨ 1 ≤ x ≤ 2}.
d. Retain the integers from (c). Answer: {−2, −1, 1, 2}.
Source: book answer key

### Exercise 3.1 #7 (book page 119)
Question: Let S be the set of all strings of length 3 consisting of a’s, b’s, and c’s. List all the strings in S that satisfy the following conditions:
1. Every string in S begins with b.
2. No string in S has more than one c.
Solution:
The strings beginning with b are baa, bab, bac, bba, bbb, bbc, bca, bcb, bcc. Exclude bcc because it has two c’s. Answer: {baa, bab, bac, bba, bbb, bbc, bca, bcb}.
Source: book answer key

### Exercise 3.1 #9 (book page 119)
Question: Find a counterexample to show that the statement is false: ∀x ∈ ℝ, x ≥ 1/x.
Solution:
Let x = 1/2. Then 1/x = 2 and 1/2 < 2. Answer: x = 1/2 is a counterexample, so the statement is false. (At x = 0, 1/x is undefined; the counterexample is nonzero.)
Source: book answer key

### Exercise 3.1 #11 (book page 119)
Question: Find a counterexample to show that the statement is false: ∀ positive integers m and n, m·n ≥ m + n.
Solution:
Let m = n = 1. Then m·n = 1 and m + n = 2, so m·n < m + n. Answer: m = n = 1 is a counterexample; the statement is false.
Source: book answer key

### Exercise 3.1 #13 (book page 119)
Question: Consider the statement “∀ basketball player x, x is tall.” Which of the following are equivalent ways of expressing this statement?
a. Every basketball player is tall.
b. Among all the basketball players, some are tall.
c. Some of all the tall people are basketball players.
d. Anyone who is tall is a basketball player.
e. All people who are basketball players are tall.
f. Anyone who is a basketball player is a tall person.
Solution:
a. This asserts tallness of every basketball player. Answer: Equivalent.
b. This asserts only the existence of a tall basketball player. Answer: Not equivalent.
c. This asserts only the existence of a tall basketball player. Answer: Not equivalent.
d. This reverses the hypothesis and conclusion. Answer: Not equivalent.
e. This asserts that being a basketball player implies being tall. Answer: Equivalent.
f. This asserts that being a basketball player implies being tall. Answer: Equivalent.
Source: book answer key

### Exercise 3.1 #15 (book page 120)
Question: Rewrite the following statements informally in at least two different ways without using variables or quantifiers.
a. ∀ rectangle x, x is a quadrilateral.
b. ∃ a set A such that A has 16 subsets.
Solution:
a. Answer: Every rectangle is a quadrilateral. / All rectangles are quadrilaterals.
b. Answer: At least one set has 16 subsets. / Some set has 16 subsets.
Source: book answer key

### Exercise 3.1 #17 (book page 120)
Question: Rewrite each of the following in the form “∃ ___ x such that ___.”
a. Some exercises have answers.
b. Some real numbers are rational.
Solution:
a. Answer: ∃ an exercise x such that x has an answer.
b. Answer: ∃ a real number x such that x is rational.
Source: book answer key

### Exercise 3.1 #19 (book page 120)
Question: Consider the statement “∀ integer n, if n² is even then n is even.” Which of the following are equivalent ways of expressing this statement?
a. All integers have even squares and are even.
b. Given any integer whose square is even, that integer is itself even.
c. For all integers, there are some whose square is even.
d. Any integer with an even square is even.
e. If the square of an integer is even, then that integer is even.
f. All even integers have even squares.
Solution:
a. This asserts that every integer is even and has an even square, rather than a conditional. Answer: Not equivalent.
b. This says that any integer with an even square must be even. Answer: Equivalent.
c. This asserts existence of integers with even squares, not the required implication. Answer: Not equivalent.
d. This is the given universal conditional in different words. Answer: Equivalent.
e. This is the given universal conditional with implicit universal quantification. Answer: Equivalent.
f. This reverses the hypothesis and conclusion. Answer: Not an equivalent reformulation.
Source: book answer key

### Exercise 3.1 #21 (book page 120)
Question: Rewrite the following statements so that the quantifier trails the rest of the sentence.
a. For any graph G, the total degree of G is even.
b. For any isosceles triangle T, the base angles of T are equal.
c. There exists a prime number p such that p is even.
d. There exists a continuous function f such that f is not differentiable.
Solution:
a. Answer: The total degree of G is even, for any graph G.
b. Answer: The base angles of T are equal, for any isosceles triangle T.
c. Answer: p is even, for some prime number p.
d. Answer: f is not differentiable, for some continuous function f.
Source: book answer key

### Exercise 3.1 #23 (book page 120)
Question: Rewrite each of the following statements in the two forms “∀x, if ___ then ___” and “∀ ___ x, ___” (without an if-then).
a. All equilateral triangles are isosceles.
b. Every computer science student needs to take data structures.
Solution:
a. Answer: ∀x, if x is an equilateral triangle then x is isosceles. / ∀ equilateral triangle x, x is isosceles.
b. Answer: ∀x, if x is a computer science student then x needs to take data structures. / ∀ computer science student x, x needs to take data structures.
Source: book answer key

### Exercise 3.1 #25 (book page 120)
Question: The statement “The square of any rational number is rational” can be rewritten formally as “For all rational numbers x, x² is rational” or as “For all x, if x is rational then x² is rational.” Rewrite each of the following statements in the two forms “∀ ___ x, ___” and “∀x, if ___, then ___” or in the two forms “∀ ___ x and y, ___” and “∀x and y, if ___, then ___.”
a. The reciprocal of any nonzero fraction is a fraction.
b. The derivative of any polynomial function is a polynomial function.
c. The sum of the angles of any triangle is 180°.
d. The negative of any irrational number is irrational.
e. The sum of any two even integers is even.
f. The product of any two fractions is a fraction.
Solution:
a. Answer: ∀ nonzero fraction x, the reciprocal of x is a fraction. / ∀x, if x is a nonzero fraction then the reciprocal of x is a fraction.
b. Answer: ∀ polynomial function x, the derivative of x is a polynomial function. / ∀x, if x is a polynomial function then the derivative of x is a polynomial function.
c. Answer: ∀ triangle x, the sum of the angles of x is 180°. / ∀x, if x is a triangle then the sum of the angles of x is 180°.
d. Answer: ∀ irrational number x, −x is irrational. / ∀x, if x is irrational then −x is irrational.
e. Answer: ∀ even integers x and y, x + y is even. / ∀x and y, if x and y are even integers then x + y is even.
f. Answer: ∀ fractions x and y, x·y is a fraction. / ∀x and y, if x and y are fractions then x·y is a fraction.
Source: book answer key

### Exercise 3.1 #27 (book page 121)
Question: Refer to the picture of Tarski’s world given in Example 3.1.13 (Figure 3.1.1, book page 118). Let Above(x, y) mean that x is above y (but possibly in a different column). Determine the truth or falsity of each of the following statements. Give reasons for your answers. The domain is the set of objects in the picture.
a. ∀u, Circle(u) → Gray(u).
b. ∀u, Gray(u) → Circle(u).
c. ∃y such that Square(y) ∧ Above(y, d).
d. ∃z such that Triangle(z) ∧ Above(f, z).
Solution:
a. Object b is a black circle, not a gray circle. Answer: False.
b. The gray objects are d, f, i, and k, all circles. Answer: True.
c. The squares e, h, and j are all below d; no square is above d. Answer: False.
d. Object g is a triangle below f, so Triangle(g) ∧ Above(f, g) is true. Answer: True.
Source: book answer key

### Exercise 3.1 #29 (book page 121)
Question: Rewrite each statement without using quantifiers or variables. Indicate which are true and which are false, and justify your answers as best as you can. Let the domain of x be the set of geometric figures in the plane, and let Square(x) be “x is a square” and Rect(x) be “x is a rectangle.”
a. ∃x such that Rect(x) ∧ Square(x).
b. ∃x such that Rect(x) ∧ ~Square(x).
c. ∀x, Square(x) → Rect(x).
Solution:
a. A unit square is both a rectangle and a square. Answer: Some rectangle is a square. True.
b. A rectangle with side lengths 1 and 2 is not a square. Answer: Some rectangle is not a square. True.
c. A square has four right angles, so it satisfies the definition of a rectangle. Answer: Every square is a rectangle. True.
Source: solved and checked

### Exercise 3.1 #31 (book page 121)
Question: In any mathematics or computer science text other than this book, find an example of a statement that is universal but is implicitly quantified. Copy the statement as it appears and rewrite it making the quantification explicit. Give a complete citation for your example, including title, author, publisher, year, and page number.
Solution:
Statement: “If a series is absolutely convergent, then it is convergent.”
Answer: ∀ series s, if s is absolutely convergent then s is convergent.
Citation: Richard Hammack, *Book of Proof*, third edition (edition 3.4), published by Richard Hammack, Richmond, Virginia, 2018, p. 114. [Text](https://richardhammack.github.io/BookOfProof/Main.pdf), PDF page 126.
Source: solved and checked

### Exercise 3.1 #33 (book page 121)
Question: Let ℝ be the domain of the predicate variables a, b, c, and d. Which of the following are true and which are false? Give counterexamples for the statements that are false.
a. a > 0 and b > 0 → ab > 0.
b. a < 0 and b < 0 → ab < 0.
c. ab = 0 → a = 0 or b = 0.
d. a < b and c < d → ac < bd.
Solution:
a. The product of two positive real numbers is positive. Answer: True.
b. Let a = −2 and b = −3. Then both are negative, but ab = 6 > 0. Answer: False.
c. If a = 0 the conclusion holds. If a ≠ 0, dividing ab = 0 by a gives b = 0. Answer: True.
d. Let a = −2, b = −1, c = −2, and d = −1. Then a < b and c < d, but ac = 4 > 1 = bd. Answer: False.
Source: book answer key

### Exercise 3.2 #1 (book page 129)
Question: Which of the following is a negation for “All discrete mathematics students are athletic”? More than one answer may be correct.
a. There is a discrete mathematics student who is nonathletic.
b. All discrete mathematics students are nonathletic.
c. There is an athletic person who is not a discrete mathematics student.
d. No discrete mathematics students are athletic.
e. Some discrete mathematics students are nonathletic.
f. No athletic people are discrete mathematics students.
Solution:
The negation of ∀ discrete mathematics students x, x is athletic, is ∃ a discrete mathematics student x such that x is nonathletic. Answer: a and e. Parts b, d, and f deny athleticism to every such student; c does not assert a nonathletic student exists.
Source: book answer key

### Exercise 3.2 #3 (book page 129)
Question: Write a formal negation for each statement.
a. ∀ string s, s has at least one character.
b. ∀ computer c, c has a CPU.
c. ∃ a movie m such that m is over 6 hours long.
d. ∃ a band b such that b has won at least 10 Grammy awards.
Solution:
a. Negate the universal quantifier and its predicate. Answer: ∃ a string s such that s has no characters.
b. Negate the universal quantifier and its predicate. Answer: ∃ a computer c such that c does not have a CPU.
c. Negate the existential quantifier and its predicate. Answer: ∀ movies m, m is at most 6 hours long.
d. Negate the existential quantifier and its predicate. Answer: ∀ bands b, b has won fewer than 10 Grammy awards.
Source: book answer key

### Exercise 3.2 #5 (book page 129)
Question: Write a negation for each statement.
a. Every valid argument has a true conclusion.
b. All real numbers are positive, negative, or zero.
Solution:
a. ~(∀ valid arguments A, A has a true conclusion). Answer: There is a valid argument that does not have a true conclusion.
b. ~(∀x ∈ ℝ, x > 0 ∨ x < 0 ∨ x = 0). Answer: ∃x ∈ ℝ such that x ≤ 0 ∧ x ≥ 0 ∧ x ≠ 0; that is, some real number is neither positive nor negative nor zero.
Source: book answer key

### Exercise 3.2 #7 (book page 130)
Question: Write a negation for each statement.
a. This vertex is not connected to any other vertex in the graph.
b. This number is not related to any even number.
Solution:
a. Negating “no other vertex” gives “at least one other vertex.” Answer: This vertex is connected to at least one other vertex in the graph.
b. Negating “no even number” gives “some even number.” Answer: This number is related to at least one even number.
Source: book answer key

### Exercise 3.2 #9 (book page 130)
Question: Write a negation: ∀ real numbers x, if x > 3 then x² > 9.
Solution:
~(∀x ∈ ℝ, x > 3 → x² > 9) is ∃x ∈ ℝ such that x > 3 ∧ ~(x² > 9). Answer: ∃x ∈ ℝ such that x > 3 ∧ x² ≤ 9.
Source: book answer key

### Exercise 3.2 #11 (book page 130)
Question: Determine whether the proposed negation is correct. If not, write a correct negation. Statement: The sum of any two irrational numbers is irrational. Proposed negation: The sum of any two irrational numbers is rational.
Solution:
The negation must assert a counterexample, not a universal claim. Answer: The proposed negation is incorrect. There exist two irrational numbers whose sum is rational. For example, √2 + (−√2) = 0.
Source: book answer key

### Exercise 3.2 #13 (book page 130)
Question: Determine whether the proposed negation is correct. If not, write a correct negation. Statement: For every integer n, if n² is even then n is even. Proposed negation: For every integer n, if n² is even then n is not even.
Solution:
~(∀n ∈ ℤ, P(n) → Q(n)) is ∃n ∈ ℤ such that P(n) ∧ ~Q(n). Answer: The proposed negation is incorrect. ∃n ∈ ℤ such that n² is even and n is not even.
Source: book answer key

### Exercise 3.2 #15 (book page 130)
Question: Let D = {−48, −14, −8, 0, 1, 3, 16, 23, 26, 32, 36}. Determine which statements are true and which are false. Provide counterexamples for false statements.
a. ∀x ∈ D, if x is odd then x > 0.
b. ∀x ∈ D, if x < 0 then x is even.
c. ∀x ∈ D, if x is even then x ≤ 0.
d. ∀x ∈ D, if the ones digit of x is 2, then the tens digit is 3 or 4.
e. ∀x ∈ D, if the ones digit of x is 6, then the tens digit is 1 or 2.
Solution:
a. The odd elements are 1, 3, and 23, all positive. Answer: True.
b. The negative elements are −48, −14, and −8, all even. Answer: True.
c. 16 is even but 16 > 0. Answer: False; counterexample x = 16.
d. The only element with ones digit 2 is 32, whose tens digit is 3. Answer: True.
e. 36 has ones digit 6 but tens digit 3. Answer: False; counterexample x = 36.
Source: book answer key

### Exercise 3.2 #17 (book page 130)
Question: Write a negation: ∀ integers d, if 6/d is an integer then d = 3.
Solution:
The expression 6/d requires d ≠ 0, understood throughout. Negate the universal conditional. Answer: ∃d ∈ ℤ with d ≠ 0 such that 6/d ∈ ℤ ∧ d ≠ 3. For example, d = 1 satisfies this negation.
Source: solved and checked

### Exercise 3.2 #19 (book page 130)
Question: Write a negation: ∀n ∈ ℤ, if n is prime then n is odd or n = 2.
Solution:
Negating the conclusion gives ~(n is odd ∨ n = 2), equivalent to n is not odd ∧ n ≠ 2. Answer: ∃n ∈ ℤ such that n is prime ∧ n is not odd ∧ n ≠ 2.
Source: solved and checked

### Exercise 3.2 #21 (book page 130)
Question: Write a negation: ∀ integers n, if n is divisible by 6, then n is divisible by 2 and n is divisible by 3.
Solution:
Negate the universal conditional and apply De Morgan’s law to the conclusion. Answer: ∃n ∈ ℤ such that n is divisible by 6 ∧ (n is not divisible by 2 ∨ n is not divisible by 3).
Source: solved and checked

### Exercise 3.2 #23 (book page 130)
Question: Write a negation: If a function is differentiable then it is continuous.
Solution:
The statement implicitly quantifies over all functions. Answer: There exists a function that is differentiable and is not continuous.
Source: solved and checked

### Exercise 3.2 #25 (book page 130)
Question: Each statement is true. In each case write its converse and give a counterexample showing that the converse is false.
a. If n is any prime number that is greater than 2, then n + 1 is even.
b. If m is any odd integer, then 2m is even.
c. If two circles intersect in exactly two points, then they do not have a common center.
Solution:
a. Reverse hypothesis and conclusion. Answer: If n + 1 is an even integer, then n is a prime number greater than 2. False: n = 15 gives n + 1 = 16 even, but 15 is composite.
b. Reverse hypothesis and conclusion. Answer: If 2m is even, then m is an odd integer. False: m = 2 gives 2m = 4 even, but m is even.
c. Reverse hypothesis and conclusion. Answer: If two circles do not have a common center, then they intersect in exactly two points. False: radius-1 circles centered at (0, 0) and (3, 0) have different centers but do not intersect.
Source: book answer key

### Exercise 3.2 #27 (book page 130)
Question: For the statement in Exercise 17, write the contrapositive, converse, and inverse. Indicate which are true and false, and give a counterexample for each false statement. Statement: ∀ integers d, if 6/d is an integer then d = 3.
Solution:
Use d ∈ ℤ with d ≠ 0 throughout, since 6/d must be defined.
a. Contrapositive: ∀d, d ≠ 3 → 6/d ∉ ℤ. Answer: False; d = 1 gives d ≠ 3 but 6/d = 6 ∈ ℤ.
b. Converse: ∀d, d = 3 → 6/d ∈ ℤ. Since 6/3 = 2, Answer: True.
c. Inverse: ∀d, 6/d ∉ ℤ → d ≠ 3. If d = 3, then 6/d = 2 is an integer. Answer: True.
Source: solved and checked

### Exercise 3.2 #29 (book page 130)
Question: For the statement in Exercise 19, write the contrapositive, converse, and inverse. Indicate which are true and false, and give a counterexample for each false statement. Statement: ∀n ∈ ℤ, if n is prime then n is odd or n = 2.
Solution:
a. Contrapositive: ∀n ∈ ℤ, (n is not odd ∧ n ≠ 2) → n is not prime. Every even integer other than 2 is nonprime. Answer: True.
b. Converse: ∀n ∈ ℤ, (n is odd ∨ n = 2) → n is prime. Answer: False; n = 9 is odd but not prime.
c. Inverse: ∀n ∈ ℤ, n is not prime → (n is not odd ∧ n ≠ 2). Answer: False; n = 9 is not prime but is odd.
Source: solved and checked

### Exercise 3.2 #31 (book page 130)
Question: For the statement in Exercise 21, write the contrapositive, converse, and inverse. Indicate which are true and false, and give a counterexample for each false statement. Statement: ∀ integers n, if n is divisible by 6, then n is divisible by 2 and n is divisible by 3.
Solution:
a. Contrapositive: ∀n ∈ ℤ, (n is not divisible by 2 ∨ n is not divisible by 3) → n is not divisible by 6. If n = 6k, then n = 2(3k) = 3(2k). Answer: True.
b. Converse: ∀n ∈ ℤ, (n is divisible by 2 ∧ n is divisible by 3) → n is divisible by 6. Write n = 3k. Since n is even and 3 is odd, k = 2j for some integer j, so n = 6j. Answer: True.
c. Inverse: ∀n ∈ ℤ, n is not divisible by 6 → (n is not divisible by 2 ∨ n is not divisible by 3). This is the contrapositive of the true converse. Answer: True.
Source: solved and checked

### Exercise 3.2 #33 (book page 130)
Question: For the statement in Exercise 23, write the contrapositive, converse, and inverse. Indicate which are true and false, and give a counterexample for each false statement. Statement: If a function is differentiable then it is continuous.
Solution:
a. Contrapositive: For every function f, if f is not continuous then f is not differentiable. Differentiability implies continuity, so its contrapositive holds. Answer: True.
b. Converse: For every function f, if f is continuous then f is differentiable. Answer: False; f(x) = |x| is continuous on ℝ but not differentiable at 0, where its one-sided derivatives are −1 and 1.
c. Inverse: For every function f, if f is not differentiable then f is not continuous. Answer: False; f(x) = |x| is not differentiable at 0 but is continuous there (and everywhere on ℝ).
Source: solved and checked

### Exercise 3.2 #35 (book page 131)
Question: Give an example to show that a universal conditional statement is not logically equivalent to its inverse.
Solution:
Consider ∀x ∈ ℝ, x > 2 → x² > 4, which is true. Its inverse is ∀x ∈ ℝ, x ≤ 2 → x² ≤ 4, which is false: x = −3 satisfies x ≤ 2 but x² = 9 > 4. Answer: This statement and its inverse have different truth values, so they are not logically equivalent.
Source: solved and checked

### Exercise 3.2 #37 (book page 131)
Question: Consider the sequence of digits 0204. A person claims that all the 1’s in the sequence are to the left of all the 0’s in the sequence. Is this true? Justify your answer. (Hint: Write the claim formally and write a formal negation for it. Is the negation true or false?)
Solution:
Let s₁s₂s₃s₄ = 0204. The claim is ∀i ∈ {1, 2, 3, 4}, sᵢ = 1 → (every position j with sⱼ = 0 satisfies i < j). Its negation is ∃i ∈ {1, 2, 3, 4} such that sᵢ = 1 and some zero occurs at a position j with i ≥ j. There is no position with sᵢ = 1, so the negation is false. Answer: The claim is vacuously true.
Source: book answer key

### Exercise 3.2 #39 (book page 131)
Question: Rewrite in if-then form: Earning a grade of C− in this course is a sufficient condition for it to count toward graduation.
Solution:
A sufficient condition is the hypothesis. Answer: If a person earns a grade of C− in this course, then the course counts toward graduation.
Source: book answer key

### Exercise 3.2 #41 (book page 131)
Question: Rewrite in if-then form: Being on time each day is a necessary condition for keeping this job.
Solution:
Negating the necessary condition prevents the outcome. Answer: If a person is not on time each day, then the person will not keep this job.
Source: book answer key

### Exercise 3.2 #43 (book page 131)
Question: Rewrite in if-then form: A number is prime only if it is greater than 1.
Solution:
“P only if Q” means P → Q. Answer: If a number is prime, then it is greater than 1.
Source: book answer key

### Exercise 3.2 #45 (book page 131)
Question: Use the facts that the negation of a ∀ statement is a ∃ statement and the negation of an if-then statement is an and statement to rewrite without “necessary” or “sufficient”: Being divisible by 8 is not a necessary condition for being divisible by 4.
Solution:
Negate ∀n ∈ ℤ, n is not divisible by 8 → n is not divisible by 4. Answer: There exists an integer that is not divisible by 8 and is divisible by 4. For example, 4 has these properties.
Source: book answer key

### Exercise 3.2 #47 (book page 131)
Question: Use the facts that the negation of a ∀ statement is a ∃ statement and the negation of an if-then statement is an and statement to rewrite without “necessary” or “sufficient”: Having a large income is not a sufficient condition for a person to be happy.
Solution:
Negate ∀ people p, p has a large income → p is happy. Answer: There is a person who has a large income and is not happy.
Source: book answer key

### Exercise 3.2 #49 (book page 131)
Question: The computer scientists Richard Conway and David Gries once wrote: “The absence of error messages during translation of a computer program is only a necessary and not a sufficient condition for reasonable [program] correctness.” Rewrite this statement without using “necessary” or “sufficient.”
Solution:
Let E(P) mean that translation of P produces no error messages, and C(P) mean that P is reasonably correct. The claim is (∀ programs P, C(P) → E(P)) ∧ ~(∀ programs P, E(P) → C(P)). Answer: If a program is reasonably correct, then its translation produces no error messages; and there exists a program whose translation produces no error messages but which is not reasonably correct.
Source: solved and checked

### Exercise 3.2 #50 (book page 131)
Question: A frequent-flyer club brochure states, “You may select among carriers only if they offer the same lowest fare.” Assuming that “only if” has its formal, logical meaning, does this statement guarantee that if two carriers offer the same lowest fare, the customer will be free to choose between them? Explain.
Solution:
Let P mean that the customer may select among the carriers and Q mean that they offer the same lowest fare. The brochure asserts P → Q, equivalently ~Q → ~P, not Q → P. When Q is true and P is false, P → Q is still true. Answer: No; equal lowest fares do not guarantee freedom to choose between the carriers.
Source: book answer key

### Exercise 3.3 #1 (book page 143)
Question: Let C be the set of cities in the world, let N be the set of nations in the world, and let P(c, n) be “c is the capital city of n.” Determine the truth values of the following statements.
a. P(Tokyo, Japan)
b. P(Athens, Egypt)
c. P(Paris, France)
d. P(Miami, Brazil)
Solution:
a. Tokyo is the capital of Japan. Answer: True.
b. Athens is the capital of Greece, not Egypt. Answer: False.
c. Paris is the capital of France. Answer: True.
d. Brasília, not Miami, is the capital of Brazil. Answer: False.
Source: book answer key

### Exercise 3.3 #3 (book page 143)
Question: The following statement is true: “∀ nonzero real number x, ∃ a real number y such that xy = 1.” For each x given below, find a y to make the predicate “xy = 1” true.
a. x = 2
b. x = −1
c. x = 3/4
Solution:
a. 2(1/2) = 1. Answer: y = 1/2.
b. (−1)(−1) = 1. Answer: y = −1.
c. (3/4)(4/3) = 1. Answer: y = 4/3.
Source: book answer key

### Exercise 3.3 #5 (book page 143)
Question: Referring to the Tarski world in Figure 3.3.1, explain why the following is true: For every circle x there is a square y such that x and y have the same color.
Solution:
The circles are a, b, and c. For blue circles a and c choose blue square j; for gray circle b choose gray square g (or h). Every circle has a matching square. Answer: True.
Source: book answer key

### Exercise 3.3 #7 (book page 143)
Question: Referring to the Tarski world in Figure 3.3.1, explain why the following is true: There is a triangle x such that for every square y, x is above y.
Solution:
Choose triangle d. The squares are e, g, h, and j, and d is above each of them. Answer: True, with x = d.
Source: book answer key

### Exercise 3.3 #9 (book page 143)
Question: Let D = E = {−2, −1, 0, 1, 2}. Explain why the following statements are true.
a. ∀x ∈ D, ∃y ∈ E such that x + y = 0.
b. ∃x ∈ D such that ∀y ∈ E, x + y = y.
Solution:
a. For each x choose y = −x, which belongs to E. The pairs (x, y) are (−2, 2), (−1, 1), (0, 0), (1, −1), (2, −2), and each has sum 0. Answer: True.
b. Choose x = 0 ∈ D. Then 0 + y = y for every y ∈ E. Answer: True.
Source: book answer key

### Exercise 3.3 #11 (book page 143)
Question: Let S be the set of students at your school, let M be the set of movies that have ever been released, and let V(s, m) be “student s has seen movie m.” Rewrite each statement without using ∀, ∃, or variables.
a. ∃s ∈ S such that V(s, Casablanca).
b. ∀s ∈ S, V(s, Star Wars).
c. ∀s ∈ S, ∃m ∈ M such that V(s, m).
d. ∃m ∈ M such that ∀s ∈ S, V(s, m).
e. ∃s ∈ S, ∃t ∈ S, and ∃m ∈ M such that s ≠ t and V(s, m) ∧ V(t, m).
f. ∃s ∈ S and ∃t ∈ S such that s ≠ t and ∀m ∈ M, V(s, m) → V(t, m).
Solution:
a. Answer: Some student at your school has seen Casablanca.
b. Answer: Every student at your school has seen Star Wars.
c. Answer: Every student at your school has seen at least one movie.
d. Answer: There is a movie that every student at your school has seen.
e. Answer: Two distinct students at your school have seen the same movie.
f. Answer: There are two distinct students at your school such that one has seen every movie the other has seen.
Source: book answer key

### Exercise 3.3 #13 (book page 143)
Question: For “∀ color C, ∃ an animal A such that A is colored C,” (a) rewrite the statement in English without ∀, ∃, or variables, as simply as possible, and (b) write a negation.
Solution:
a. Answer: There are animals of every color.
b. ~(∀C ∃A Colored(A, C)) ≡ ∃C ∀A ~Colored(A, C). Answer: There is a color that no animal has.
Source: book answer key

### Exercise 3.3 #15 (book page 143)
Question: For “∀ odd integer n, ∃ an integer k such that n = 2k + 1,” (a) rewrite the statement in English without ∀, ∃, or variables, as simply as possible, and (b) write a negation.
Solution:
a. Answer: Every odd integer equals twice some integer plus one.
b. Interchange ∀ and ∃ and negate the equality. Answer: ∃ an odd integer n such that ∀k ∈ ℤ, n ≠ 2k + 1. In words, some odd integer does not equal twice any integer plus one.
Source: book answer key

### Exercise 3.3 #17 (book page 143)
Question: For “∀r ∈ ℚ, ∃ integers a and b such that r = a/b,” (a) rewrite the statement in English without ∀, ∃, or variables, as simply as possible, and (b) write a negation.
Solution:
a. The quotient requires a nonzero denominator. Answer: Every rational number is a quotient of two integers with nonzero denominator.
b. Negating ∀r ∈ ℚ ∃a ∈ ℤ ∃b ∈ ℤ\{0}, r = a/b gives ∃r ∈ ℚ ∀a ∈ ℤ ∀b ∈ ℤ\{0}, r ≠ a/b. Answer: Some rational number is not a quotient of any two integers with nonzero denominator.
Source: solved and checked

### Exercise 3.3 #19 (book page 143)
Question: For “∃x ∈ ℝ such that for every real number y, x + y = 0,” (a) rewrite the statement in English without ∀, ∃, or variables, as simply as possible, and (b) write a negation.
Solution:
a. Answer: There is a real number whose sum with every real number is zero.
b. ~(∃x ∈ ℝ ∀y ∈ ℝ, x + y = 0) ≡ ∀x ∈ ℝ ∃y ∈ ℝ, x + y ≠ 0. Answer: For every real number, there is a real number whose sum with it is nonzero.
Source: solved and checked

### Exercise 3.3 #21 (book page 144)
Question: For each equation, determine which statements are true: (1) For every real number x, there exists a real number y such that the equation is true. (2) There exists a real number x such that for every real number y, the equation is true. Both statements may be true or both may be false.
a. 2x + y = 7
b. y + x = x + y
c. x² − 2xy + y² = 0
d. (x − 5)(y − 1) = 0
e. x² + y² = −1
Solution:
a. (1) Given x, take y = 7 − 2x. (2) Taking y = 0 would force x = 7/2, while y = 1 would force x = 3. Answer: (1) True; (2) False.
b. Real addition is commutative for all x and y. For (2), x = 0 works for every y. Answer: Both true.
c. The equation is (x − y)² = 0, equivalent to y = x. Thus (1) holds by choosing y = x. No fixed x equals every y; y = x + 1 makes the square 1. Answer: (1) True; (2) False.
d. For (1), choose y = 1 for any x. For (2), choose x = 5 for every y. Answer: Both true.
e. For real x and y, x² + y² ≥ 0, so it cannot equal −1. Answer: Both false.
Source: book answer key

### Exercise 3.3 #23 (book page 144)
Question: Rewrite each statement without variables or ∀ or ∃. Indicate whether it is true or false.
a. ∀ nonzero real number r, ∃ a real number s such that rs = 1.
b. ∃ a real number r such that ∀ nonzero real number s, rs = 1.
Solution:
a. Every nonzero real number has a reciprocal. Given r ≠ 0, take s = 1/r; then rs = 1. Answer: True.
b. There is one real number whose product with every nonzero real number is one. Using s = 1 forces r = 1, but then s = 2 gives rs = 2 ≠ 1. Answer: False.
Source: solved and checked

### Exercise 3.3 #25 (book page 144)
Question: In the Tarski world of Figure 3.3.1, consider “∀ circle x and ∀ square y, x is above y.” (a) Determine whether the statement is true or false and justify your answer. (b) Write a negation.
Solution:
a. The circles are a, b, c and the squares are e, g, h, j. Each circle is above every square. Answer: True.
b. ~(∀ circle x ∀ square y, Above(x, y)) ≡ ∃ circle x ∃ square y, ~Above(x, y). Answer: There is a circle and a square such that the circle is not above the square.
Source: book answer key

### Exercise 3.3 #27 (book page 144)
Question: In the Tarski world of Figure 3.3.1, consider “∃ a circle x and ∃ a square y such that x is above y and x and y have different colors.” (a) Determine whether the statement is true or false and justify your answer. (b) Write a negation.
Solution:
a. Choose circle a and square e: a is above e, and a is blue whereas e is black. Answer: True.
b. Negate the two existential quantifiers and apply De Morgan’s law. Answer: For every circle x and every square y, x is not above y or x and y have the same color.
Source: book answer key

### Exercise 3.3 #29 (book page 144)
Question: For “∀x ∈ ℝ, ∃y ∈ ℝ such that x < y,” (a) write a new statement by interchanging ∀ and ∃, and (b) state which is true: the given statement, the interchanged version, neither, or both.
Solution:
a. Answer: ∃x ∈ ℝ such that ∀y ∈ ℝ, x < y.
b. In the original, choose y = x + 1. In the interchanged version, choosing y = x would require x < x. Answer: Only the given statement is true.
Source: book answer key

### Exercise 3.3 #31 (book page 144)
Question: Consider “Everybody is older than somebody.” Rewrite this statement in the form “∀ people x, ∃ ____.”
Solution:
The person who is younger may depend on x. Answer: ∀ person x, ∃ a person y such that x is older than y.
Source: book answer key

### Exercise 3.3 #33 (book page 144)
Question: For “Everybody loves somebody,” (a) rewrite the statement formally using quantifiers and variables, and (b) write a negation.
Solution:
a. Answer: ∀ person x, ∃ a person y such that x loves y.
b. ~(∀x ∃y Loves(x, y)) ≡ ∃x ∀y ~Loves(x, y). Answer: There is a person who loves nobody.
Source: book answer key

### Exercise 3.3 #35 (book page 144)
Question: For “Everybody trusts somebody,” (a) rewrite the statement formally using quantifiers and variables, and (b) write a negation.
Solution:
a. Answer: ∀ person x, ∃ a person y such that x trusts y.
b. ~(∀x ∃y Trusts(x, y)) ≡ ∃x ∀y ~Trusts(x, y). Answer: There is a person who trusts nobody.
Source: solved and checked

### Exercise 3.3 #37 (book page 144)
Question: For “Any even integer equals twice some integer,” (a) rewrite the statement formally using quantifiers and variables, and (b) write a negation.
Solution:
a. Answer: ∀ even integer n, ∃k ∈ ℤ such that n = 2k.
b. Negating reverses the quantifiers and replaces = by ≠. Answer: ∃ an even integer n such that ∀k ∈ ℤ, n ≠ 2k. Some even integer does not equal twice any integer.
Source: book answer key

### Exercise 3.3 #39 (book page 144)
Question: For “There is a program that gives the correct answer to every question that is posed to it,” (a) rewrite the statement formally using quantifiers and variables, and (b) write a negation.
Solution:
a. Answer: ∃ a program P such that ∀ question Q posed to P, P gives the correct answer to Q.
b. Negating ∃P ∀Q gives ∀P ∃Q, and the answer condition is negated. Answer: For every program P, there is a question Q posed to P for which P does not give the correct answer.
Source: book answer key

### Exercise 3.3 #41 (book page 145)
Question: Indicate which statements are true and which are false. Justify your answers as best you can. Here ℤ⁺ and ℝ⁺ denote the positive integers and positive real numbers.
a. ∀x ∈ ℤ⁺, ∃y ∈ ℤ⁺ such that x = y + 1.
b. ∀x ∈ ℤ, ∃y ∈ ℤ such that x = y + 1.
c. ∃x ∈ ℝ such that ∀y ∈ ℝ, x = y + 1.
d. ∀x ∈ ℝ⁺, ∃y ∈ ℝ⁺ such that xy = 1.
e. ∀x ∈ ℝ, ∃y ∈ ℝ such that xy = 1.
f. ∃x ∈ ℝ such that ∀y ∈ ℝ, x + y = y.
g. ∀x ∈ ℝ⁺, ∃y ∈ ℝ⁺ such that y < x.
h. ∃x ∈ ℝ⁺ such that ∀y ∈ ℝ⁺, x ≤ y.
Solution:
a. At x = 1, the equation requires y = 0 ∉ ℤ⁺. Answer: False.
b. Given x ∈ ℤ, choose y = x − 1 ∈ ℤ. Then y + 1 = x. Answer: True.
c. Taking y = 0 forces x = 1, whereas y = 1 forces x = 2. Answer: False.
d. Given x > 0, choose y = 1/x > 0; then xy = 1. Answer: True.
e. At x = 0, xy = 0 ≠ 1 for every real y. Answer: False.
f. Choose x = 0. Then 0 + y = y for every real y. Answer: True.
g. Given x > 0, choose y = x/2; then 0 < y < x. Answer: True.
h. For any proposed x > 0, the positive number y = x/2 satisfies y < x. Answer: False.
Source: book answer key

### Exercise 3.3 #43 (book page 145)
Question: The following is the definition for lim_{x→a} f(x) = L: For every real number ε > 0, there exists a real number δ > 0 such that for every real number x, if a − δ < x < a + δ and x ≠ a then L − ε < f(x) < L + ε. Write what it means for lim_{x→a} f(x) ≠ L; in other words, write the negation of the definition.
Solution:
Reverse ∀ε ∃δ ∀x to ∃ε ∀δ ∃x. The negation of A → B is A ∧ ~B, and ~(L − ε < f(x) < L + ε) is f(x) ≤ L − ε ∨ f(x) ≥ L + ε.
Answer: ∃ε ∈ ℝ⁺ such that ∀δ ∈ ℝ⁺, ∃x ∈ ℝ such that (a − δ < x < a + δ) ∧ x ≠ a ∧ (f(x) ≤ L − ε ∨ f(x) ≥ L + ε).
Source: solved and checked

### Exercise 3.3 #45 (book page 145)
Question: Suppose P(x) is a predicate and D is the domain of x. Rewrite “∃!x ∈ D such that P(x)” without using ∃!. Here ∃! means “there exists a unique.”
Solution:
Require one element satisfying P and require every element satisfying P to equal it. Answer: ∃x ∈ D such that P(x) ∧ (∀y ∈ D, P(y) → y = x).
Source: solved and checked

### Exercise 3.3 #47 (book page 145)
Question: Refer to the Tarski world of Figure 3.1.1, reproduced on page 145. All variables range over all objects in that world. For “There is a triangle x such that for every circle y, x is above y,” (a) indicate truth or falsity and justify, (b) write the statement in formal logical notation as in Example 3.3.10, and (c) write its negation in that notation.
Solution:
a. Circle b is in the top row. No triangle is above b: a is in the same row, while c and g are below it. Answer: False.
b. With Triangle, Circle, and Above having their usual meanings, answer: ∃x(Triangle(x) ∧ ∀y(Circle(y) → Above(x, y))).
c. Reverse the outer quantifiers and negate the implication inside. Answer: ∀x(~Triangle(x) ∨ ∃y(Circle(y) ∧ ~Above(x, y))).
Source: solved and checked

### Exercise 3.3 #49 (book page 145)
Question: Refer to the Tarski world of Figure 3.1.1, reproduced on page 145. All variables range over all objects in that world. For “For every object x, if x is a circle then there is a square y such that y has the same color as x,” (a) indicate truth or falsity and justify, (b) write the statement in formal logical notation as in Example 3.3.10, and (c) write its negation in that notation.
Solution:
a. Circles d, f, i, k are gray, but the squares are e (blue) and h, j (black). There is no gray square. Answer: False.
b. SameColor(x, y) means x and y have the same color. Answer: ∀x(Circle(x) → ∃y(Square(y) ∧ SameColor(y, x))).
c. Negate the implication and the existential statement. Answer: ∃x(Circle(x) ∧ ∀y(~Square(y) ∨ ~SameColor(y, x))).
Source: solved and checked

### Exercise 3.3 #51 (book page 145)
Question: Refer to the Tarski world of Figure 3.1.1, reproduced on page 145. All variables range over all objects in that world. For “There is a square x such that for every triangle y, if y is above x then y has the same color as x,” (a) indicate truth or falsity and justify, (b) write the statement in formal logical notation as in Example 3.3.10, and (c) write its negation in that notation.
Solution:
a. Choose blue square e. The triangles above e are a and c, both blue; triangle g is below e. Answer: True.
b. SameColor(y, x) means y and x have the same color. Answer: ∃x(Square(x) ∧ ∀y((Triangle(y) ∧ Above(y, x)) → SameColor(y, x))).
c. The negation requires a triangle above each square that differs in color from it. Answer: ∀x(~Square(x) ∨ ∃y(Triangle(y) ∧ Above(y, x) ∧ ~SameColor(y, x))).
Source: solved and checked

### Exercise 3.3 #53 (book page 145)
Question: Refer to the Tarski world of Figure 3.1.1, reproduced on page 145. All variables range over all objects in that world. For “There is a circle x and there is a square y such that x and y have the same color,” (a) indicate truth or falsity and justify, (b) write the statement in formal logical notation as in Example 3.3.10, and (c) write its negation in that notation.
Solution:
a. Choose circle b and square h (or j), both black. Answer: True.
b. SameColor(x, y) means x and y have the same color. Answer: ∃x ∃y(Circle(x) ∧ Square(y) ∧ SameColor(x, y)).
c. Reverse both existential quantifiers and negate the conjunction. Answer: ∀x ∀y(~Circle(x) ∨ ~Square(y) ∨ ~SameColor(x, y)).
Source: solved and checked

### Exercise 3.3 #55 (book page 145)
Question: Let P(x) and Q(x) be predicates and D the domain of x. For the pair “∀x ∈ D, (P(x) ∧ Q(x))” and “(∀x ∈ D, P(x)) ∧ (∀x ∈ D, Q(x)),” determine whether (a) they have the same truth value for every choice of P, Q, D, or (b) some choice makes their truth values opposite.
Solution:
If every x satisfies P(x) ∧ Q(x), every x satisfies P(x) and every x satisfies Q(x). Conversely, if every x satisfies P(x) and every x satisfies Q(x), each x satisfies their conjunction. This also holds for D = ∅, when all universal statements are true. Answer: (a), the forms are logically equivalent.
Source: solved and checked

### Exercise 3.3 #57 (book page 146)
Question: Let P(x) and Q(x) be predicates and D the domain of x. For the pair “∀x ∈ D, (P(x) ∨ Q(x))” and “(∀x ∈ D, P(x)) ∨ (∀x ∈ D, Q(x)),” determine whether (a) they have the same truth value for every choice of P, Q, D, or (b) some choice makes their truth values opposite.
Solution:
Let D = {1, 2}, P(x) mean x = 1, and Q(x) mean x = 2. Each element satisfies P or Q, so ∀x ∈ D, (P(x) ∨ Q(x)) is true. But P(2) is false and Q(1) is false, so both universal statements on the right are false, making their disjunction false. Answer: (b), they can have opposite truth values.
Source: solved and checked

### Exercise 3.3 #59 (book page 146)
Question: Find the answers Prolog would give if the following questions were added to the program in Example 3.3.11:
a. ?isabove(b1, w1)
b. ?color(X, white)
c. ?isabove(X, b3)
The program has the facts isabove(g, b1), isabove(b1, w1), isabove(w2, b2), isabove(b2, b3); color(g, gray), color(b1, blue), color(b2, blue), color(b3, blue), color(w1, white), color(w2, white); and the rule isabove(X, Z) if isabove(X, Y) and isabove(Y, Z).
Solution:
a. isabove(b1, w1) is a given fact. Answer: Yes.
b. The white-block facts are color(w1, white) and color(w2, white). Answer: X = w1; X = w2.
c. The fact isabove(b2, b3) gives b2; the chain w2 above b2 above b3 gives w2 by the rule. No other block is above b3. Answer: X = b2; X = w2.
Source: solved and checked
