/**
 * Minimal, opinionated data masking - on by default, no rule engine to configure.
 * Covers the two things SMBs most often leak into logs: card numbers and US SSNs.
 * Intentionally NOT a CMDT-driven rule framework; add patterns here as needed.
 */
public with sharing class DataMasker {
  private static final Map<String, String> PATTERN_TO_REPLACEMENT = new Map<String, String>{
    '\\b(?:\\d[ -]*?){13,16}\\b' => '***CARD***',
    '\\b\\d{3}-\\d{2}-\\d{4}\\b' => '***SSN***'
  };

  public static String mask(String input) {
    if (String.isBlank(input)) {
      return input;
    }
    String output = input;
    for (String regex : PATTERN_TO_REPLACEMENT.keySet()) {
      output = System.Pattern.compile(regex).matcher(output).replaceAll(PATTERN_TO_REPLACEMENT.get(regex));
    }
    return output;
  }
}
