import player

import world

import util

import random

class Test():
    """This is an example class that has one function"""
    def foo(self):
        class DeeplyNested():
            def bar(self):
                return 42
        return DeeplyNested()


mc = Test()

def get_rand_num():
    rand = random.randint(2, 8)
    return expo_mod(2, 2222, rand)


def expo_mod(num, expo, mod):
    """Raises <num> to the <expo> and modes by <mod>"""
    print(expo)
    if expo == 0:
        return 1
    else:
        z = expo_mod(num, int(expo/2), mod)
        if expo % 2 == 0:
            ret = (z**2) % mod
            return ret
        else:
            return (num * z**2) % mod


def main():
    b = mc.foo()
    c = b.bar()
    print(c)

    p = player.get_player()
    w = world.get_starting_world()
    print("Player ability:", player.get_ability(p))
    print("Monsters:\n" + "\n".join(w))
    print(f"Likelihood of failure: {util.square(get_rand_num())}%")


def rec():
    rec()
    
if __name__ == "__main__":
    main()
