import requests
import re

pat_coolness = re.compile(r"<b>Universal Coolness Index</b></a> of <i>([\d\.]+?)%</i>")
pat_attribute = re.compile(r"<li>(.+?)[\.!].+?([\d\.]+?)\%")

pat_tags = re.compile(r"<[^>]+>")

def coolness_to_string(num):
	if num >= 99:
		return "extremely cool"
	elif num >= 95:
		return "very cool"
	elif num >= 90:
		return "cool"
	elif num >= 75:
		return "almost cool"
	elif num >= 50:
		return "so-so"
	else:
		return "definitely uncool"

def coolness(num): # returns coolness percentage, coolness string, list containing attributes of the number in form [("factorial of 5", 0.000011%), ("contains a 6-of-a-kind together", 0.000011%)]
	r = requests.post("http://www.coolnumbers.com/crunch.asp", data={"serial": num, "source": 3})

	if r.status_code != 200: return

	coolness_pct = float(pat_coolness.search(r.text).group(1))
	return coolness_pct / 100, coolness_to_string(coolness_pct), map(lambda x: (pat_tags.sub("", x[0]), float(x[1])), pat_attribute.findall(r.text))

def check(num):
	r = coolness(num)

	# r[0] is the number out of 1
	print("UCI: ", r[0])

	# r[1] is the string
	print("Coolness string: ", r[1])

	# r[2] is a list of its attributes
	print("Attributes:")
	for attr in r[2]:
		print(attr[0], "Commonness percentage: ", attr[1])

if __name__ == "__main__":
	check(24)
