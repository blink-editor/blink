import jedi

# https://jedi.readthedocs.io/en/latest/#docs
# https://jedi.readthedocs.io/en/latest/docs/api.html
# https://jedi.readthedocs.io/en/latest/docs/api-classes.html

# first we need to get a list of definitions in the script
# we do this with `jedi.names`, which is a wrapper around `jedi.Script`
#
# we could also do this by setting the cursor to the end and calling
# script.goto_definitions()
defs = jedi.names(path="example.py")

print("jedi.names Definitions:")
for defn in defs:
	print(f"{defn.name}:")
	print(f"\ttype: {defn.type}")
	print(f"\tmodule_name: {defn.module_name}")
	print(f"\tfull_name: {defn.full_name}")
	print(f"\tin_builtin_module: {defn.in_builtin_module()}")
	print(f"\tline, column: {defn.line}, {defn.column}")
	# we have to dig in to the AST objects to get the actual code for this function
	print(f"\tbody start: {defn._name.tree_name.parent.start_pos}")
	print(f"\tbody end: {defn._name.tree_name.parent.end_pos}")
	# print(f"\t{defn._name.tree_name.parent.get_code()}")
	# print(f"\tDefined Names (e.g. class methods): {defn.defined_names()}")

# line=cursor line, column=cursor column
script = jedi.Script(path="example.py")

print("Assignments:")
print(script.goto_assignments())

print("Definitions:")
print(script.goto_definitions())

# print("Completions:")
# print(script.completions())

print("Usages:")
print(script.usages())
