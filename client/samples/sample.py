import math
from __future__ import print_function

def firstFunction():
	print("first")


def secondFunction():
	print("second")


def thirdFunction():
	print("third")


def logger():
	from math import log
	return math.log(2)


def rooter():
	return math.sqrt(49)


class Dog():
	def __init__(self): pass

	def foo(self):
		class Helper():
			def __init__(self):
				pass
			def bar(self):
				return 5
		return Helper().bar()


def main():
	a = Dog()
	a.foo()
	firstFunction()
	secondFunction()
	thirdFunction()


def test():
	main()

test()
