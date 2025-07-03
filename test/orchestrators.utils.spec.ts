// utils/response-sanitizer.test.ts
import { describe, it, expect } from 'vitest';
import { sanitizeResponse } from '../src/orchestrators/utils';

describe('sanitizeResponse', () => {
  describe('with preserveThinkingTags: false (default)', () => {
    it('should remove thinking tags and their content', () => {
      const input = '<thinking>This is internal reasoning</thinking>\n\nHello, user!';
      const expected = 'Hello, user!';
      expect(sanitizeResponse(input)).toBe(expected);
    });

    it('should remove multiple thinking tags', () => {
      const input = '<thinking>First thought</thinking>\n\nResponse here\n\n<thinking>Second thought</thinking>\n\nMore response';
      const expected = 'Response here\n\nMore response';
      expect(sanitizeResponse(input)).toBe(expected);
    });

    it('should handle thinking tags with multiline content', () => {
      const input = `<thinking>
        This is a long thought
        that spans multiple lines
        with various reasoning
      </thinking>

      The actual response is here.`;
      const expected = 'The actual response is here.';
      expect(sanitizeResponse(input)).toBe(expected);
    });

    it('should handle thinking tags at the end of text', () => {
      const input = 'Here is the response.\n\n<thinking>Some final thoughts</thinking>';
      const expected = 'Here is the response.';
      expect(sanitizeResponse(input)).toBe(expected);
    });

    it('should handle thinking tags in the middle of text', () => {
      const input = 'Start of response\n\n<thinking>Middle thoughts</thinking>\n\nEnd of response';
      const expected = 'Start of response\n\nEnd of response';
      expect(sanitizeResponse(input)).toBe(expected);
    });

    it('should handle nested thinking tags (non-greedy matching)', () => {
      const input = '<thinking>Outer <thinking>inner</thinking> thought</thinking>\n\nResponse';
      // With non-greedy matching, this should remove the first complete thinking tag
      const expected = 'thought</thinking>\n\nResponse';
      expect(sanitizeResponse(input)).toBe(expected);
    });

    it('should handle text with no thinking tags', () => {
      const input = 'Just a regular response with no special tags.';
      const expected = 'Just a regular response with no special tags.';
      expect(sanitizeResponse(input)).toBe(expected);
    });

    it('should handle empty string', () => {
      const input = '';
      const expected = '';
      expect(sanitizeResponse(input)).toBe(expected);
    });

    it('should handle whitespace-only string', () => {
      const input = '   \n\n\t  ';
      const expected = '';
      expect(sanitizeResponse(input)).toBe(expected);
    });

    it('should handle string with only thinking tags', () => {
      const input = '<thinking>Only internal thoughts here</thinking>';
      const expected = '';
      expect(sanitizeResponse(input)).toBe(expected);
    });

    it('should trim leading and trailing whitespace', () => {
      const input = '   \n\n  Response with whitespace  \n\n  ';
      const expected = 'Response with whitespace';
      expect(sanitizeResponse(input)).toBe(expected);
    });

    it('should handle complex real-world example', () => {
      const input = `<thinking> The Garden Bed agent has provided the list of garden beds. I will summarize this information for the user. </thinking>



The names of your garden beds are:
1. Left Triangle
2. Center Bed
3. Melon Bed
4. Butterfly Garden

Would you like more detailed information about any of these beds?`;

      const expected = `The names of your garden beds are:
1. Left Triangle
2. Center Bed
3. Melon Bed
4. Butterfly Garden

Would you like more detailed information about any of these beds?`;

      expect(sanitizeResponse(input)).toBe(expected);
    });
  });

  describe('with preserveThinkingTags: true', () => {
    it('should preserve thinking tags but still trim whitespace', () => {
      const input = '   <thinking>Keep this</thinking>\n\nResponse here   ';
      const expected = '<thinking>Keep this</thinking>\n\nResponse here';
      expect(sanitizeResponse(input, { preserveThinkingTags: true })).toBe(expected);
    });

    it('should handle empty string with preserve option', () => {
      const input = '';
      const expected = '';
      expect(sanitizeResponse(input, { preserveThinkingTags: true })).toBe(expected);
    });

    it('should preserve complex thinking tags', () => {
      const input = `<thinking>
        Complex reasoning here
        with multiple lines
      </thinking>

      The response follows.`;

      const expected = `<thinking>
        Complex reasoning here
        with multiple lines
      </thinking>

      The response follows.`;

      expect(sanitizeResponse(input, { preserveThinkingTags: true })).toBe(expected);
    });
  });

  describe('edge cases', () => {
    it('should handle unclosed thinking tags (no effect)', () => {
      const input = '<thinking>Unclosed tag\n\nResponse here';
      // Unclosed tags won't match the regex, so no replacement occurs
      const expected = '<thinking>Unclosed tag\n\nResponse here';
      expect(sanitizeResponse(input)).toBe(expected);
    });

    it('should handle thinking tags with attributes (no effect)', () => {
      const input = '<thinking type="internal">Attributed thinking</thinking>\n\nResponse';
      // The regex looks for exact `<thinking>` tags, not tags with attributes
      const expected = '<thinking type="internal">Attributed thinking</thinking>\n\nResponse';
      expect(sanitizeResponse(input)).toBe(expected);
    });

    it('should handle case-sensitive thinking tags', () => {
      const input = '<THINKING>Uppercase</THINKING>\n\n<Thinking>Mixed case</Thinking>\n\nResponse';
      // Our regex is case-sensitive, so these should NOT be removed
      const expected = '<THINKING>Uppercase</THINKING>\n\n<Thinking>Mixed case</Thinking>\n\nResponse';
      expect(sanitizeResponse(input)).toBe(expected);
    });

    it('should handle thinking tags with special characters in content', () => {
      const input = '<thinking>Special chars: &lt; &gt; &amp; "quotes" \'apostrophes\'</thinking>\n\nResponse';
      const expected = 'Response';
      expect(sanitizeResponse(input)).toBe(expected);
    });
  });
});
