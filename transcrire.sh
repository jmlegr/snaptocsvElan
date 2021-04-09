
#!/bin/bash

if [[ $# -ne 1 ]]; then
    echo "$0: Un nom de fichier contenant les sessions est requis (sans extension)."
    exit 4
fi
filename="$1.txt";
n=1
while read line; do
# reading each line
echo "Session No. $n : $line"
node index.js -s $line -f transcription_$1_
n=$((n+1))
done < $filename
