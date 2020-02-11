def square(x):
    """
    Returns the square of x.
    Used in many places.
    """
    return x * x

CONFIG = {
    "difficulty": 4
}

def get_config_var(name):
    return CONFIG[name]
