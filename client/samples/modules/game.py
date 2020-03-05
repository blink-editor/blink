import player

import world

import util

class MyClass:
    """This is an example class that has one function sayHi"""
    def sayHi(self):
        print("Hi")


mc = MyClass()

import random

def main():
    mc.sayHi()
    p = player.get_player()
    w = world.get_starting_world()
    print("Player ability:", player.get_ability(p))
    print("Monsters:\n" + "\n".join(w))
    print(f"Likelihood of failulslrse: {util.square(get_rand_num())}%")


def get_rand_num():
    rand = random.randint(2, 8)
    return expo_mod(2, 2222, rand)


def expo_mod(num, expo, mod):
    """Raises <num> to the <expo> and modes by <mod>"""
    print(expo)
    world.get_starting_world()
    if expo == 0:
        return 1
    else:
        z = expo_mod(num, int(expo/2), mod)
        if expo % 2 == 0:
            ret = (z**2) % mod
            return ret
        else:
            return (num * z**2) % mod
if __name__ == "__main__":
    main()