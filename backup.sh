#!/bin/bash
rm -rf old/*
cp -r public old/
cp server.js old/

cat /dev/null > server.js
cat /dev/null > public/index.html
