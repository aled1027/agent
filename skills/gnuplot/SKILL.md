---
name: gnuplot
description: Create and open a PNG chart in Zed with gnuplot from data in the current context. Use for line, bar, scatter, histogram, or candlestick plots when a visual chart is more useful than a table or terminal text chart.
allowed-tools: bash
---

# Plot data with gnuplot

Create a self-contained PNG from data in the current context and open it in Zed's image viewer.

## Workflow

1. Extract or derive the data to plot from the current context. If none is available, ask for data or a query.
2. Create a timestamped temporary output path such as `/tmp/agent-plot-$(date +%s).png` and a matching `.gp` script. Do not use descriptive output filenames.
3. Write and run the gnuplot script.
4. Verify that the PNG exists and is non-empty.
5. Open the image in the existing Zed window:

   ```sh
   zed -e /tmp/agent-plot-XXXX.png
   ```

6. Report the opened file path. Do not rely on a Markdown image link rendering inside Zed's terminal.

## Zed rendering

Render an opaque, light-background PNG so labels remain readable in Zed's image viewer. Use this baseline:

```gnuplot
set terminal pngcairo enhanced size 800,500 background rgb "#ffffff"
set output "/tmp/agent-plot-XXXX.png"

FG = "#1f2328"
set border lc rgb FG
set key textcolor rgb FG noopaque nobox
set xlabel textcolor rgb FG
set ylabel textcolor rgb FG
set title textcolor rgb FG
set xtics textcolor rgb FG
set ytics textcolor rgb FG
```

Use `set key outside` when a legend would overlap dense data. For filled charts, use a translucent fill such as `fs transparent solid 0.15`.

`enhanced` interprets `_` as a subscript marker. Escape literal underscores in titles, labels, and legend text (for example, write `PLUME\_USDT` to display `PLUME_USDT`).

## Data and chart selection

- Use inline data (`$DATA << EOD ... EOD`) for small datasets. For large datasets, write a separate temporary data file.
- Use lines for time series, bars or histograms for categorical/count data, points for sparse observations, and candlesticks for OHLC data.
- Include a title and axis labels. Include a legend only when multiple series need identification.
- Use human-facing market notation in display text: render a database symbol such as `PLUME_USDT` as `PLUME/USDT`. Keep the underscore form only in SQL and other machine-facing identifiers.
- Preserve units, time zones, and data age in the title, axis labels, or adjacent response text where relevant.

Run and validate with:

```sh
gnuplot /tmp/agent-plot-XXXX.gp
test -s /tmp/agent-plot-XXXX.png
zed -e /tmp/agent-plot-XXXX.png
```
