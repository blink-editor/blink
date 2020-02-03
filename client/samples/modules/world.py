import util
import player

def get_starting_world():
    p = player.get_player()
    world = []
    ability = player.get_ability(p)
    for i in range(util.square(ability)):
        monster = f"Monster {i}"
        world.append(monster)
    return world
