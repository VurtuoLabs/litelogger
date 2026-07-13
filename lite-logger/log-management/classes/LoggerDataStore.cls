/**
 * Thin seam around Big Object DML. Big Object writes can't be rolled back in Apex tests
 * (and `insertImmediate` isn't test-safe), so tests swap in a mock via `setMock()`.
 */
public inherited sharing virtual class LoggerDataStore {
  private static LoggerDataStore instance = new LoggerDataStore();

  public static LoggerDataStore getInstance() {
    return instance;
  }

  @TestVisible
  private static void setMock(LoggerDataStore mock) {
    instance = mock;
  }

  public virtual void insertImmediate(List<SObject> records) {
    Database.insertImmediate(records);
  }

  public virtual void deleteImmediate(List<SObject> records) {
    Database.deleteImmediate(records);
  }
}
