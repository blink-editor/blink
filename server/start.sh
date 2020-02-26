#!/usr/bin/env sh
export PATH=$PWD/../client/:$PATH # set path for ctags
pipenv run pyls --tcp -vv
