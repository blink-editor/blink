import player

import world

import util

def main():
    p = player.get_player()
    w = world.get_starting_world()
    print("Player ability:", player.get_ability(p))
    print("Monsters:\n" + "\n".join(w))
    print(f"Likelihood of failure: {util.square(10)}%")
    another_func()


def another_func():
    print("yes")if __name__ == "__main__":
    main()
