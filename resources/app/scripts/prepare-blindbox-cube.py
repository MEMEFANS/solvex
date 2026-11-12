"""Composite the original SVX mark on three cube faces and split the moving lid."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent.parent / 'output/imagegen/svx-blindbox-cube-v4'
DEST = ROOT / 'public/assets/blindbox'
DEST.mkdir(parents=True, exist_ok=True)
sheet = Image.open(SOURCE / 'svx-box-cube-states-v4.png').convert('RGBA')
assert sheet.size == (2496, 1664), 'Inspect face coordinates when regenerating this source.'
mark = Image.open(ROOT / 'public/assets/brand/logo.png').convert('RGBA')
mark = mark.crop(mark.getbbox())
mark.thumbnail((820, 820), Image.Resampling.LANCZOS)
logo = Image.new('RGBA', (1024, 1024))
logo.alpha_composite(mark, ((1024-mark.width)//2, (1024-mark.height)//2))
outline = Image.new('RGBA', logo.size, 'white')
outline.putalpha(logo.getchannel('A').filter(ImageFilter.MaxFilter(9)))
outline.alpha_composite(logo)

def solve(matrix, values):
    rows = [list(row) + [value] for row, value in zip(matrix, values)]
    for column in range(8):
        pivot = max(range(column, 8), key=lambda row: abs(rows[row][column]))
        rows[column], rows[pivot] = rows[pivot], rows[column]
        divisor = rows[column][column]
        assert abs(divisor) > 1e-10
        rows[column] = [value / divisor for value in rows[column]]
        for row in range(8):
            if row != column:
                factor = rows[row][column]
                rows[row] = [a-factor*b for a, b in zip(rows[row], rows[column])]
    return tuple(row[-1] for row in rows)

def place_logo(face):
    corners = [(x*1.3, y*1.3) for x, y in face]
    def point(u, v):
        return tuple((1-u)*(1-v)*corners[0][i] + u*(1-v)*corners[1][i] + u*v*corners[2][i] + (1-u)*v*corners[3][i] for i in range(2))
    targets = [point(.14,.14), point(.86,.14), point(.86,.86), point(.14,.86)]
    matrix, values = [], []
    for (x, y), (u, v) in zip(targets, [(0,0), (1024,0), (1024,1024), (0,1024)]):
        matrix += [[x,y,1,0,0,0,-u*x,-u*y], [0,0,0,x,y,1,-v*x,-v*y]]
        values += [u,v]
    sheet.alpha_composite(outline.transform(sheet.size, Image.Transform.PERSPECTIVE, solve(matrix,values), Image.Resampling.BICUBIC))

place_logo([(1086,497),(1450,594),(1450,1045),(1086,923)])
place_logo([(1454,593),(1757,478),(1757,901),(1454,1045)])
# The lid logo stays vector-based in the browser so it remains legible at mobile sizes.

# Remove only near-white pixels connected to the canvas edge.
eligible = Image.new('L', sheet.size)
eligible.putdata([255 if min(pixel) >= 246 and max(pixel)-min(pixel) <= 6 else 0 for pixel in sheet.convert('RGB').get_flattened_data()])
ImageDraw.floodfill(eligible, (0,0), 128, thresh=0)
sheet.putalpha(eligible.point(lambda value: 0 if value == 128 else 255))
sheet.save(SOURCE / 'svx-cube-branded-source.png')
opened = sheet.crop((1248,0,2496,1664))
lid_mask = Image.new('L', opened.size)
lid_outline = [(1078,294),(1393,171),(1411,171),(1762,274),(1764,300),(1460,426),(1442,426),(1078,317)]
ImageDraw.Draw(lid_mask).polygon([(round(x*1.3-1248),round(y*1.3)) for x,y in lid_outline], fill=255)
lid_mask = lid_mask.filter(ImageFilter.MaxFilter(13))
lid = Image.new('RGBA', opened.size); lid.paste(opened, mask=lid_mask)
body = opened.copy(); body.paste((0,0,0,0), mask=lid_mask)
component = body.getchannel('A').point(lambda value: 255 if value else 0)
ImageDraw.floodfill(component, (600,1100), 128, thresh=0)
body.putalpha(Image.composite(body.getchannel('A'), Image.new('L', body.size), component.point(lambda value: 255 if value == 128 else 0)))

def crop_frame(image):
    return image.crop((80,160,1130,1440)).resize((600,732), Image.Resampling.LANCZOS)

for name, image in [('body',body),('lid',lid)]:
    image = crop_frame(image)
    filename = f'svx-cube-{name}-v{5 if name == "lid" else 4}.webp'
    image.save(DEST / filename, 'WEBP', quality=92, method=6)
    print(f'{name}: {(DEST / filename).stat().st_size} bytes')

preview = Image.new('RGBA',(1200,820),'#f7f3ff')
lid_logo_path = SOURCE / 'lid-logo-overlay.png'
if lid_logo_path.exists():
    lid_logo = Image.open(lid_logo_path).convert('RGBA').resize((1050,1280),Image.Resampling.LANCZOS)
    lid.alpha_composite(lid_logo,(80,160))
for index, name in enumerate(['closed','opened']):
    state = body.copy()
    state.alpha_composite(lid, (0,252 if name == 'closed' else 0))
    state = crop_frame(state)
    state.save(SOURCE / f'svx-cube-{name}-v4.png')
    preview.alpha_composite(state,(600*index,40))
preview.convert('RGB').save(SOURCE / 'svx-cube-preview.jpg',quality=95)
