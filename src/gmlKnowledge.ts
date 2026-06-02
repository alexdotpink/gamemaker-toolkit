export interface GmlBuiltin {
  name: string;
  signature: string;
  description: string;
  kind: "function" | "constant" | "variable";
}

export const GML_BUILTINS: GmlBuiltin[] = [
  {
    name: "draw_sprite",
    signature: "draw_sprite(sprite, subimg, x, y)",
    description: "Draws a sprite at an x/y position.",
    kind: "function",
  },
  {
    name: "draw_sprite_ext",
    signature: "draw_sprite_ext(sprite, subimg, x, y, xscale, yscale, rot, colour, alpha)",
    description: "Draws a sprite with scale, rotation, blend color, and alpha.",
    kind: "function",
  },
  {
    name: "draw_text",
    signature: "draw_text(x, y, string)",
    description: "Draws text at an x/y position.",
    kind: "function",
  },
  {
    name: "draw_text_ext",
    signature: "draw_text_ext(x, y, string, sep, w)",
    description: "Draws wrapped text with line spacing and width.",
    kind: "function",
  },
  {
    name: "draw_set_font",
    signature: "draw_set_font(font)",
    description: "Sets the active font for drawing text.",
    kind: "function",
  },
  {
    name: "show_debug_message",
    signature: "show_debug_message(value)",
    description: "Writes a value to GameMaker's debug output.",
    kind: "function",
  },
  {
    name: "keyboard_check",
    signature: "keyboard_check(key)",
    description: "Returns true while a key is held.",
    kind: "function",
  },
  {
    name: "keyboard_check_pressed",
    signature: "keyboard_check_pressed(key)",
    description: "Returns true on the frame a key is pressed.",
    kind: "function",
  },
  {
    name: "keyboard_check_released",
    signature: "keyboard_check_released(key)",
    description: "Returns true on the frame a key is released.",
    kind: "function",
  },
  {
    name: "instance_create_layer",
    signature: "instance_create_layer(x, y, layer, object)",
    description: "Creates an instance on a named layer.",
    kind: "function",
  },
  {
    name: "instance_create_depth",
    signature: "instance_create_depth(x, y, depth, object)",
    description: "Creates an instance at a depth.",
    kind: "function",
  },
  {
    name: "instance_destroy",
    signature: "instance_destroy([id])",
    description: "Destroys the current or targeted instance.",
    kind: "function",
  },
  {
    name: "room_goto",
    signature: "room_goto(room)",
    description: "Moves to a room.",
    kind: "function",
  },
  {
    name: "audio_play_sound",
    signature: "audio_play_sound(sound, priority, loop)",
    description: "Plays a sound resource.",
    kind: "function",
  },
  {
    name: "sqr",
    signature: "sqr(value)",
    description: "Returns value multiplied by itself.",
    kind: "function",
  },
  {
    name: "floor",
    signature: "floor(value)",
    description: "Rounds a number down.",
    kind: "function",
  },
  {
    name: "string",
    signature: "string(value)",
    description: "Converts a value to a string.",
    kind: "function",
  },
  {
    name: "string_char_at",
    signature: "string_char_at(string, index)",
    description: "Returns the character at a 1-based index.",
    kind: "function",
  },
  {
    name: "vk_enter",
    signature: "vk_enter",
    description: "Enter key virtual-key constant.",
    kind: "constant",
  },
  {
    name: "vk_left",
    signature: "vk_left",
    description: "Left arrow virtual-key constant.",
    kind: "constant",
  },
  {
    name: "vk_right",
    signature: "vk_right",
    description: "Right arrow virtual-key constant.",
    kind: "constant",
  },
  { name: "c_white", signature: "c_white", description: "White color constant.", kind: "constant" },
  { name: "c_black", signature: "c_black", description: "Black color constant.", kind: "constant" },
  {
    name: "global",
    signature: "global",
    description: "Global variable namespace.",
    kind: "variable",
  },
  { name: "self", signature: "self", description: "The current instance.", kind: "variable" },
  {
    name: "other",
    signature: "other",
    description: "The other instance in an event context.",
    kind: "variable",
  },
];

export function findBuiltin(name: string): GmlBuiltin | undefined {
  return GML_BUILTINS.find((builtin) => builtin.name === name);
}
