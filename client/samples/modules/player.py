import util

def get_player():
    return {
        "health": util.square(5),
        "ability": 7,
    }

def get_ability(p):
    return p["ability"]
