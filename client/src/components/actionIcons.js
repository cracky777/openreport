// The glyphs for the actions that recur everywhere, named once.
//
// The app had drifted: TbTrash for delete but TbX on one card, TbEdit and
// TbPencil both meaning "edit" — sometimes in the same file — and the same
// action drawn at 10, 12, 14 and 16px depending on who wrote the screen.
// Importing the icon straight from react-icons is what let that happen, so
// action buttons import the intent from here instead of picking a picture.
import { TbTrash, TbEdit, TbPlus } from 'react-icons/tb';

export const DeleteIcon = TbTrash;
export const EditIcon = TbEdit;
export const AddIcon = TbPlus;

// One size per context, so an action keeps its weight relative to what
// surrounds it rather than to whoever placed it.
export const ICON_SIZE = {
  card: 16,   // a row of actions on a full-width card
  modal: 14,  // the same row inside a dialog, where everything is a notch down
  chip: 12,   // inline with text — a tag, a link, a rule
};
