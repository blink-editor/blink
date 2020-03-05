import util

import player

def get_starting_world():
    world = []

    p = player.get_player()
    ability = player.get_ability(p)

    difficulty = util.get_config_var("difficulty")

    for i in range(util.square(ability) * difficulty):
        monster = f"Monster {i}"
        world.append(monster)

    return world
