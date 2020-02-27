import player

import world

import util

class MyClass:
    def sayHi(self):
        print("Hi")


mc = MyClass()

def main():
    mc.sayHi()
    p = player.get_player()
    w = world.get_starting_world()
    print("Player ability:", player.get_ability(p))
    print("Monsters:\n" + "\n".join(w))
    print(f"Likelihood of failure: {util.square(10)}%")
if __name__ == "__main__":
    main()
