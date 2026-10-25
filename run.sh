#!/usr/bin/env bash
if [ -x "/opt/godot/Godot_v4.8-beta1_mono_linux_x86_64/Godot_v4.8-beta1_mono_linux.x86_64" ]; then
    GODOT_BIN="/opt/godot/Godot_v4.8-beta1_mono_linux_x86_64/Godot_v4.8-beta1_mono_linux.x86_64"
else
    GODOT_BIN="/opt/godot/Godot_v4.7.2-stable_mono_linux.x86_64"
fi
exec "$GODOT_BIN" --path godot "$@"
