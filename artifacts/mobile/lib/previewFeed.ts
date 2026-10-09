/**
 * Pure, local-only feed engagement fixtures. Product/seller relationships are
 * resolved against previewCatalog by the feed consumer, so this module can be
 * tested without loading Expo assets and never touches the API or database.
 */

export interface PreviewFeedComment {
  id: string;
  user: string;
  text: string;
}

export interface PreviewFeedPostSeed {
  id: string;
  productId: string;
  videoIndex: number;
  caption?: string;
  sound?: string;
  location?: string;
  verified?: boolean;
  likes: number;
  commentsCount: number;
  comments: PreviewFeedComment[];
  reposts: number;
  shares: number;
  saves: number;
}

const CAPTIONS = [
  'Preview · Midnight tailoring, cut for movement.',
  'Preview · Silver lines and a clean architectural silhouette.',
  'Preview · Street tailoring with couture proportions.',
  'Preview · A study in ivory, volume, and soft structure.',
  'Preview · Monochrome layers designed from every angle.',
  'Preview · Draped jersey meets precision hardware.',
  'Preview · Evening light caught in hand-finished crystal.',
  'Preview · Archival shapes, reconstructed for now.',
  'Preview · Sharp shoulders. Fluid finish. No compromise.',
  'Preview · Closing look: black silk, sculpted by hand.',
  'Preview · Three ways to make a soft layer feel like a statement.',
  'Preview · A closer look at the texture, drape, and tiny details.',
  'Preview · Our favorite piece for the first warm evening out.',
  'Preview · Made to move from a slow morning to a late dinner.',
  'Preview · A familiar silhouette with a more considered finish.',
  'Preview · The kind of layer you reach for every single week.',
  'Preview · Small-run color, easy shape, endless combinations.',
  'Preview · A little shine, balanced with an everyday fit.',
  'Preview · The finishing piece that brings the whole look together.',
  'Preview · Natural texture, soft structure, and room to move.',
  'Preview · A wardrobe staple, cut with a little more intention.',
  'Preview · The studio edit: favorite fabrics in a new shape.',
  'Preview · From the first sketch to the final fitting.',
  'Preview · An easy set that still feels special.',
  'Preview · One last look at the details we love most.',
];

const SOUNDS = [
  'After Dark · Atelier Noire', 'Chrome Room · Vela Studios',
  'Concrete Waltz · Saint Rue', 'Still Form · Orison', 'Parallel · Kuro Line',
  'Soft Machine · Forme 22', 'Glass Light · Astrae', 'Reissue 08 · Noma Archive',
  'Forward Motion · Echelon', 'Finale · Vale Studio',
  'Sunday Loop · Common Hours', 'Morning Study · Morrow Form',
  'Blue Hour · Ciel Atelier', 'Soft Focus · Soft Theory',
  'Lune No. 3 · Studio Lune', 'Field Recording · Field Notes',
  'Object Lesson · Pale Objects', 'Easy Does It · Sunday Assembly',
  'Long Wear · Alder & Ash', 'After Hours · After Image',
  'Quiet Motion · Common Hours', 'Open Window · Morrow Form',
  'Salt Air · Ciel Atelier', 'Slow Sunday · Soft Theory',
  'Last Look · Studio Lune',
];

const LOCATIONS = [
  'Paris, France', 'Milan, Italy', 'New York, NY', 'London, UK',
  'Tokyo, Japan', 'Berlin, Germany', 'Los Angeles, CA', 'Copenhagen, Denmark',
  'Seoul, South Korea', 'Paris, France', 'Brooklyn, NY', 'Portland, OR',
  'Lisbon, Portugal', 'London, UK', 'New York, NY', 'Copenhagen, Denmark',
  'Melbourne, Australia', 'Los Angeles, CA', 'Amsterdam, Netherlands', 'Chicago, IL',
  'Toronto, Canada', 'Milan, Italy', 'Brooklyn, NY', 'Lisbon, Portugal',
  'Tokyo, Japan',
];

const COMMENT_POOL = [
  { user: 'Maya Chen', text: 'the proportions on this are so good' },
  { user: 'Jordan Reyes', text: 'love seeing the fabric move on video' },
  { user: 'Priya Patel', text: 'what a beautiful way to style this' },
  { user: 'Sam Okafor', text: 'saving this look for later ✨' },
  { user: 'Lena Park', text: 'the detail on the finish is everything' },
  { user: 'Diego Alvarez', text: 'this feels so effortless' },
  { user: 'Ava Thompson', text: 'need to see this in person' },
  { user: 'Noah Kim', text: 'such a good everyday statement piece' },
  { user: 'Ines Fischer', text: 'the styling is perfect, no notes' },
  { user: 'Marcus Webb', text: 'love discovering independent labels here' },
  { user: 'Ruth Adeyemi', text: 'that drape looks incredible' },
  { user: 'Toby Nguyen', text: 'instantly one of my favorite looks' },
  { user: 'Nia Brooks', text: 'the color and texture together 🤍' },
  { user: 'Oliver James', text: 'this is such a clever silhouette' },
  { user: 'Camila Torres', text: 'already thinking about how to wear this' },
  { user: 'Elliot Park', text: 'beautiful work from the whole studio' },
];

const makePostSeed = (index: number): PreviewFeedPostSeed => {
  const number = String(index + 1).padStart(2, '0');
  return {
    id: `preview-fashion-${number}`,
    productId: `preview-product-${number}`,
    videoIndex: index % 10,
    caption: CAPTIONS[index],
    sound: SOUNDS[index],
    location: LOCATIONS[index],
    verified: index % 4 !== 3,
    likes: 720 + ((index * 1_137) % 18_400),
    commentsCount: 180 + ((index * 173) % 2_700),
    comments: [0, 1, 2].map((offset) => {
      const comment = COMMENT_POOL[(index * 3 + offset) % COMMENT_POOL.length];
      return {
        id: `preview-fashion-${number}-comment-${offset + 1}`,
        user: comment.user,
        text: comment.text,
      };
    }),
    reposts: 125 + ((index * 97) % 1_600),
    shares: 145 + ((index * 181) % 3_100),
    saves: 360 + ((index * 547) % 11_000),
  };
};

/** Twenty-five local feed records, retaining the original first ten ids. */
export const PREVIEW_FEED_POSTS: PreviewFeedPostSeed[] =
  Array.from({ length: 25 }, (_, index) => makePostSeed(index));