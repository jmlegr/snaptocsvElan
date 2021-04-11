#!/bin/bash
for nb in "45" "46"
do
	for i in "a" "b" "c" "d" "e" "f" "g" "h" "i" "j" "k" "l" "m" "n" "o" 
	do 
		echo 'type,nomScript,idScript,time(milli),time,debut,fin,evenement' > transcription2019\_$nb\_$i.csv
		cat *\_$nb\_$i\_*.csv >> transcription2019\_$nb\_$i.csv
		echo "$nb $i done"
	done
done
echo 'type,nomScript,idScript,time(milli),time,debut,fin,evenement' > transcription2019_45_a.csv
cat *_45_a_*.csv >> transcription2019_45_a.csv
