#!/bin/bash

# Check if ffmpeg is installed
if ! command -v ffmpeg &> /dev/null
then
    echo "ffmpeg could not be found. Please install ffmpeg to use this script."
    exit
fi

# Function to convert a single .mov file to .mp4
convert_mov_to_mp4() {
    local input_file="$1"
    local output_file="${input_file%.mov}.mp4"
    
    echo "Converting $input_file to $output_file..."
    ffmpeg -i "$input_file" -vcodec h264 -acodec aac "$output_file"
    echo "Conversion completed for $input_file"
}

# Loop through all .mov files in the current directory
for mov_file in *.mov; do
    if [ -f "$mov_file" ]; then
        convert_mov_to_mp4 "$mov_file"
    else
        echo "No .mov files found in the current directory."
        exit
    fi
done

echo "All conversions completed."

