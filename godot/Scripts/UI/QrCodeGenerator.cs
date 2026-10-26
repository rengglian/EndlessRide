using System;
using System.Collections.Generic;
using System.Text;
using Godot;

namespace EndlessRide.UI;

public enum QrEccLevel
{
    Low = 0,
    Medium = 1,
    Quartile = 2,
    High = 3
}

/// <summary>
/// Lightweight, zero-dependency, standard ISO/IEC 18004 compliant QR Code generator.
/// Encodes UTF-8 strings into a boolean module matrix and generates crisp Godot ImageTextures.
/// Based on Project Nayuki's algorithm.
/// </summary>
public static class QrCodeGenerator
{
    private static readonly int[][] EccCodewordsPerBlock =
    {
        new[] { -1,  7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30 },
        new[] { -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28 },
        new[] { -1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 28, 26, 26, 24, 28, 28, 28, 28, 28, 28, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30 },
        new[] { -1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 24, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28 },
    };

    private static readonly int[][] NumErrorCorrectionBlocks =
    {
        new[] { -1, 1, 1, 1, 1, 1, 2, 2, 2, 2,  2,  4,  4,  4,  4,  4,  6,  6,  6,  6,  7,  8,  8,  9,  9, 10, 10, 11, 11, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24 },
        new[] { -1, 1, 1, 1, 2, 2, 4, 4, 4, 5,  5,  5,  8,  9,  9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49 },
        new[] { -1, 1, 1, 2, 2, 4, 4, 6, 6, 8,  8,  8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68 },
        new[] { -1, 1, 1, 2, 4, 4, 4, 5, 6, 8,  8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81 },
    };

    public static int GetNumRawDataModules(int ver)
    {
        int result = (16 * ver + 128) * ver + 64;
        if (ver >= 2)
        {
            int numAlign = ver / 7 + 2;
            result -= (25 * numAlign - 10) * numAlign - 55;
            if (ver >= 7)
                result -= 36;
        }
        return result;
    }

    public static int GetNumDataCodewords(int ver, QrEccLevel ecl)
    {
        int raw = GetNumRawDataModules(ver) / 8;
        return raw - NumErrorCorrectionBlocks[(int)ecl][ver] * EccCodewordsPerBlock[(int)ecl][ver];
    }

    /// <summary>
    /// Generates a 2D boolean grid representing dark (true) and light (false) modules.
    /// </summary>
    public static bool[,] GenerateMatrix(string text, QrEccLevel ecl = QrEccLevel.Medium)
    {
        byte[] textBytes = Encoding.UTF8.GetBytes(text);

        // Find smallest version (1..40) that accommodates text length
        int version = 1;
        while (version <= 40)
        {
            int cap = GetNumDataCodewords(version, ecl);
            int headerBits = 4 + (version <= 9 ? 8 : 16);
            int dataBits = textBytes.Length * 8;
            if (headerBits + dataBits <= cap * 8)
                break;
            version++;
        }

        if (version > 40)
            throw new ArgumentException("Text payload too long for standard QR Code symbol.");

        int dataCodewords = GetNumDataCodewords(version, ecl);

        // Build bit stream
        List<bool> bits = new();
        void AppendBits(int val, int len)
        {
            for (int i = len - 1; i >= 0; i--)
                bits.Add(((val >> i) & 1) != 0);
        }

        // Mode: 8-bit byte (0100)
        AppendBits(0x4, 4);
        // Character count indicator
        AppendBits(textBytes.Length, version <= 9 ? 8 : 16);
        // Data payload
        foreach (byte b in textBytes)
            AppendBits(b, 8);

        // Terminator (up to 4 zero bits)
        int maxBits = dataCodewords * 8;
        int term = Math.Min(4, maxBits - bits.Count);
        AppendBits(0, term);

        // Pad to byte boundary
        if (bits.Count % 8 != 0)
            AppendBits(0, 8 - (bits.Count % 8));

        // Pad alternating byte patterns (0xEC, 0x11)
        byte[] padBytes = { 0xEC, 0x11 };
        int padIdx = 0;
        while (bits.Count < maxBits)
        {
            AppendBits(padBytes[padIdx % 2], 8);
            padIdx++;
        }

        // Convert bit stream to codewords
        byte[] data = new byte[dataCodewords];
        for (int i = 0; i < bits.Count; i++)
        {
            if (bits[i])
                data[i / 8] |= (byte)(1 << (7 - (i % 8)));
        }

        // Append Reed-Solomon ECC and interleave blocks
        byte[] allCodewords = AddEccAndInterleave(data, version, ecl);

        int size = version * 4 + 17;
        bool[,] modules = new bool[size, size];
        bool[,] isFunction = new bool[size, size];

        void SetFunction(int x, int y, bool isDark)
        {
            modules[y, x] = isDark;
            isFunction[y, x] = true;
        }

        // 1. Horizontal and vertical timing patterns
        for (int i = 0; i < size; i++)
        {
            SetFunction(6, i, (i & 1) == 0);
            SetFunction(i, 6, (i & 1) == 0);
        }

        // 2. Three finder patterns and 1-module separators
        void DrawFinder(int cx, int cy)
        {
            for (int dy = -4; dy <= 4; dy++)
            {
                for (int dx = -4; dx <= 4; dx++)
                {
                    int dist = Math.Max(Math.Abs(dx), Math.Abs(dy));
                    int xx = cx + dx;
                    int yy = cy + dy;
                    if (xx >= 0 && xx < size && yy >= 0 && yy < size)
                    {
                        SetFunction(xx, yy, dist != 2 && dist != 4);
                    }
                }
            }
        }

        DrawFinder(3, 3);
        DrawFinder(size - 4, 3);
        DrawFinder(3, size - 4);

        // 3. Alignment patterns (version >= 2)
        int[] alignPos = GetAlignmentPatternPositions(version, size);
        for (int i = 0; i < alignPos.Length; i++)
        {
            for (int j = 0; j < alignPos.Length; j++)
            {
                if ((i == 0 && j == 0) || (i == 0 && j == alignPos.Length - 1) || (i == alignPos.Length - 1 && j == 0))
                    continue;

                int cx = alignPos[i];
                int cy = alignPos[j];
                for (int dy = -2; dy <= 2; dy++)
                {
                    for (int dx = -2; dx <= 2; dx++)
                    {
                        SetFunction(cx + dx, cy + dy, Math.Max(Math.Abs(dx), Math.Abs(dy)) != 1);
                    }
                }
            }
        }

        // 4. Reserve format and dark module locations
        for (int i = 0; i <= 8; i++)
        {
            if (i < size) { isFunction[8, i] = true; isFunction[i, 8] = true; }
        }
        for (int i = 0; i < 8; i++)
        {
            isFunction[8, size - 1 - i] = true;
            isFunction[size - 1 - i, 8] = true;
        }
        SetFunction(8, size - 8, true); // Black module

        // 5. Version information blocks (version >= 7)
        if (version >= 7)
        {
            int rem = version;
            for (int i = 0; i < 12; i++)
                rem = (rem << 1) ^ ((rem >> 11) * 0x1F25);
            int vBits = (version << 12) | rem;
            for (int i = 0; i < 18; i++)
            {
                bool bit = ((vBits >> i) & 1) != 0;
                int a = size - 11 + (i % 3);
                int b = i / 3;
                SetFunction(a, b, bit);
                SetFunction(b, a, bit);
            }
        }

        // 6. Draw data & ECC codewords in 2-column zigzag scan
        int bitIdx = 0;
        for (int right = size - 1; right >= 1; right -= 2)
        {
            if (right == 6) right = 5;
            for (int vert = 0; vert < size; vert++)
            {
                for (int j = 0; j < 2; j++)
                {
                    int x = right - j;
                    bool upward = ((right + 1) & 2) == 0;
                    int y = upward ? size - 1 - vert : vert;
                    if (!isFunction[y, x] && bitIdx < allCodewords.Length * 8)
                    {
                        bool dark = ((allCodewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) != 0;
                        modules[y, x] = dark;
                        bitIdx++;
                    }
                }
            }
        }

        // 7. Test all 8 standard mask patterns, pick the one with lowest penalty score
        int bestMask = 0;
        long bestPenalty = long.MaxValue;

        for (int mask = 0; mask < 8; mask++)
        {
            ApplyMask(modules, isFunction, mask, size);
            DrawFormatBits(modules, size, ecl, mask);
            long penalty = GetPenaltyScore(modules, size);
            if (penalty < bestPenalty)
            {
                bestPenalty = penalty;
                bestMask = mask;
            }
            ApplyMask(modules, isFunction, mask, size); // unmask
        }

        // Permanently apply optimal mask
        ApplyMask(modules, isFunction, bestMask, size);
        DrawFormatBits(modules, size, ecl, bestMask);

        return modules;
    }

    /// <summary>
    /// Generates a pixel-crisp Godot ImageTexture from the specified text URL.
    /// Includes a white quiet-zone border for camera scan reliability.
    /// </summary>
    public static ImageTexture GenerateTexture(string text, int scale = 4, int border = 2, QrEccLevel ecl = QrEccLevel.Medium)
    {
        bool[,] qr = GenerateMatrix(text, ecl);
        int qrSize = qr.GetLength(0);
        int totalSize = (qrSize + border * 2) * scale;

        var image = Image.CreateEmpty(totalSize, totalSize, false, Image.Format.Rgba8);
        Color darkColor = new Color(0.04f, 0.07f, 0.12f, 1.0f); // High-contrast deep obsidian
        Color lightColor = Colors.White; // Solid clean white quiet zone and background

        image.Fill(lightColor);

        for (int y = 0; y < qrSize; y++)
        {
            for (int x = 0; x < qrSize; x++)
            {
                if (qr[y, x])
                {
                    int startX = (x + border) * scale;
                    int startY = (y + border) * scale;
                    for (int dy = 0; dy < scale; dy++)
                    {
                        for (int dx = 0; dx < scale; dx++)
                        {
                            image.SetPixel(startX + dx, startY + dy, darkColor);
                        }
                    }
                }
            }
        }

        return ImageTexture.CreateFromImage(image);
    }

    private static void ApplyMask(bool[,] modules, bool[,] isFunction, int mask, int size)
    {
        for (int y = 0; y < size; y++)
        {
            for (int x = 0; x < size; x++)
            {
                if (!isFunction[y, x] && MaskCondition(mask, x, y))
                {
                    modules[y, x] = !modules[y, x];
                }
            }
        }
    }

    private static bool MaskCondition(int mask, int x, int y) => mask switch
    {
        0 => (x + y) % 2 == 0,
        1 => y % 2 == 0,
        2 => x % 3 == 0,
        3 => (x + y) % 3 == 0,
        4 => ((x / 3) + (y / 2)) % 2 == 0,
        5 => ((x * y) % 2) + ((x * y) % 3) == 0,
        6 => (((x * y) % 2) + ((x * y) % 3)) % 2 == 0,
        7 => (((x + y) % 2) + ((x * y) % 3)) % 2 == 0,
        _ => false
    };

    private static void DrawFormatBits(bool[,] modules, int size, QrEccLevel ecl, int mask)
    {
        int formatBitsVal = ecl switch
        {
            QrEccLevel.Low => 1,
            QrEccLevel.Medium => 0,
            QrEccLevel.Quartile => 3,
            QrEccLevel.High => 2,
            _ => 0
        };

        int data = (formatBitsVal << 3) | mask;
        int rem = data;
        for (int i = 0; i < 10; i++)
            rem = (rem << 1) ^ ((rem >> 9) * 0x537);
        int bits = ((data << 10) | rem) ^ 0x5412;

        bool GetBit(int b, int i) => ((b >> i) & 1) != 0;

        // First copy around top-left finder
        for (int i = 0; i <= 5; i++)
            modules[i, 8] = GetBit(bits, i);
        modules[7, 8] = GetBit(bits, 6);
        modules[8, 8] = GetBit(bits, 7);
        modules[8, 7] = GetBit(bits, 8);
        for (int i = 9; i < 15; i++)
            modules[8, 14 - i] = GetBit(bits, i);

        // Second copy under top-right finder and beside bottom-left finder
        for (int i = 0; i < 8; i++)
            modules[8, size - 1 - i] = GetBit(bits, i);
        for (int i = 8; i < 15; i++)
            modules[size - 15 + i, 8] = GetBit(bits, i);
    }

    private static int[] GetAlignmentPatternPositions(int version, int size)
    {
        if (version == 1) return Array.Empty<int>();
        int numAlign = (version / 7) + 2;
        int step = (version == 32) ? 26 : ((version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
        int[] result = new int[numAlign];
        result[0] = 6;
        for (int i = numAlign - 1, pos = size - 7; i >= 1; i--, pos -= step)
            result[i] = pos;
        return result;
    }

    private static byte[] AddEccAndInterleave(byte[] data, int version, QrEccLevel ecl)
    {
        int numBlocks = NumErrorCorrectionBlocks[(int)ecl][version];
        int blockEccLen = EccCodewordsPerBlock[(int)ecl][version];
        int rawCodewords = GetNumRawDataModules(version) / 8;
        int dataLen = data.Length;
        int numShortBlocks = numBlocks - (rawCodewords % numBlocks);
        int shortBlockDataLen = (rawCodewords / numBlocks) - blockEccLen;

        byte[] rsDiv = new byte[blockEccLen];
        ReedSolomonComputeDivisor(blockEccLen, rsDiv);

        byte[] result = new byte[rawCodewords];
        int datOffset = 0;

        for (int i = 0; i < numBlocks; i++)
        {
            int blockDataLen = shortBlockDataLen + (i < numShortBlocks ? 0 : 1);
            byte[] blockData = new byte[blockDataLen];
            Array.Copy(data, datOffset, blockData, 0, blockDataLen);
            datOffset += blockDataLen;

            byte[] ecc = new byte[blockEccLen];
            ReedSolomonComputeRemainder(blockData, rsDiv, ecc);

            // Copy data interleaved
            for (int j = 0, k = i; j < blockDataLen; j++, k += numBlocks)
            {
                if (j == shortBlockDataLen)
                    k -= numShortBlocks;
                result[k] = blockData[j];
            }

            // Copy ECC interleaved
            for (int j = 0, k = dataLen + i; j < blockEccLen; j++, k += numBlocks)
            {
                result[k] = ecc[j];
            }
        }

        return result;
    }

    private static void ReedSolomonComputeDivisor(int degree, byte[] result)
    {
        Array.Clear(result, 0, result.Length);
        result[degree - 1] = 1;
        byte root = 1;
        for (int i = 0; i < degree; i++)
        {
            for (int j = 0; j < degree; j++)
            {
                result[j] = ReedSolomonMultiply(result[j], root);
                if (j + 1 < degree)
                    result[j] ^= result[j + 1];
            }
            root = ReedSolomonMultiply(root, 0x02);
        }
    }

    private static void ReedSolomonComputeRemainder(byte[] data, byte[] generator, byte[] result)
    {
        int degree = generator.Length;
        Array.Clear(result, 0, result.Length);
        for (int i = 0; i < data.Length; i++)
        {
            byte factor = (byte)(data[i] ^ result[0]);
            for (int j = 0; j < degree - 1; j++)
                result[j] = result[j + 1];
            result[degree - 1] = 0;
            for (int j = 0; j < degree; j++)
                result[j] ^= ReedSolomonMultiply(generator[j], factor);
        }
    }

    private static byte ReedSolomonMultiply(byte x, byte y)
    {
        byte z = 0;
        for (int i = 7; i >= 0; i--)
        {
            z = (byte)((z << 1) ^ ((z >> 7) * 0x11D));
            z ^= (byte)(((y >> i) & 1) * x);
        }
        return z;
    }

    private static long GetPenaltyScore(bool[,] modules, int size)
    {
        long penalty = 0;

        // Rule 1: 5+ consecutive modules of same color in rows and columns
        for (int y = 0; y < size; y++)
        {
            bool color = modules[y, 0];
            int count = 1;
            for (int x = 1; x < size; x++)
            {
                if (modules[y, x] == color)
                {
                    count++;
                    if (count == 5) penalty += 3;
                    else if (count > 5) penalty++;
                }
                else
                {
                    color = modules[y, x];
                    count = 1;
                }
            }
        }

        for (int x = 0; x < size; x++)
        {
            bool color = modules[0, x];
            int count = 1;
            for (int y = 1; y < size; y++)
            {
                if (modules[y, x] == color)
                {
                    count++;
                    if (count == 5) penalty += 3;
                    else if (count > 5) penalty++;
                }
                else
                {
                    color = modules[y, x];
                    count = 1;
                }
            }
        }

        // Rule 2: 2x2 blocks of monochromatic modules
        for (int y = 0; y < size - 1; y++)
        {
            for (int x = 0; x < size - 1; x++)
            {
                bool c = modules[y, x];
                if (c == modules[y, x + 1] && c == modules[y + 1, x] && c == modules[y + 1, x + 1])
                    penalty += 3;
            }
        }

        // Rule 4: Balance of dark vs light modules (ideal is 50%)
        int darkCount = 0;
        for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
                if (modules[y, x]) darkCount++;

        int total = size * size;
        int pct = (darkCount * 100 + total / 2) / total;
        int step = Math.Abs(pct - 50) / 5;
        penalty += step * 10;

        return penalty;
    }
}
