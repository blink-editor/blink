from __future__ import print_function
import math
import nougat

def firstFunction():
    print("first")


def secondFunction():
    print("second")


def thirdFunction():
    print(nougat.nougat())


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
    thirdFunction()
    print("this is starter")


def test():
    main()
    test()
